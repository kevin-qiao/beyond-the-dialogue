import type { Destination, Task, TaskTypeDef } from '../../shared/types'
import type { PathPort } from '../ports/paths'
import type { ArtifactStorePort } from '../ports/artifactStore'
import type { AgentSessionPort } from '../ports/agent'
import type { ClockPort } from '../ports/clock'
import type { NotifierPort } from '../ports/notifier'
import type { StoragePort } from '../ports/storage'
import { confineOverride, resolveArtifact } from '../domain/destination'
import { declaredWorkflow, effectiveType } from '../domain/taskType'
import { hasUnfilledRequiredInputs } from '../domain/validation'
import { FINISH_STRATEGIES, type FinishContext, type FinishResult } from '../domain/finish'
import { writesArtifact, type FinishBehaviour } from '../domain/categories'

// Finish orchestration: the one place a task's completion is decided.
//
// Replaces the hardcoded `effectiveKind(...) === 'learning'` branch that used
// to live in the IPC handler. Dispatch is on the type's DECLARED behaviour, so
// a user-defined type follows its own declaration with no code change.
//
// Ordering is the load-bearing part. A finish that cannot succeed must fail
// while the task is still actionable, so validation and the destination check
// happen BEFORE anything is marked complete:
//
//   validate inputs → resolve + confine destination → prepare it → write
//   → mark complete, clear alarm → report
//
// Nothing here deletes, moves, or overwrites an existing artifact, and no
// assistant step inside a finish receives a plugin grant (purpose 'confined').

export interface FinishDeps {
  paths: PathPort
  storage: StoragePort
  /** The artifact store for a destination's `store` value. */
  storeFor: (dest: Destination) => ArtifactStorePort
  session: AgentSessionPort
  clock: ClockPort
  notifier: NotifierPort
  /** The configured wiki location, for `store: wiki` destinations. */
  wikiRoot: () => string
  /**
   * Hand a `deposit-then-curate` finish to the background: the deposit is the
   * part that must survive, and the curating agent is long-running work the
   * user should be able to keep working through.
   */
  enqueueCurate: (task: Task, depositFiles: string[]) => void
  /**
   * A per-task override of where the artifact goes, when the destination's
   * store allows the user to name it (a wiki destination lets a learning task
   * set its own note path). Kept as a hook so the finish service does not
   * learn any one store's input vocabulary.
   */
  taskTargetOverride?: (task: Task) => string | undefined
}

export interface FinishOutcome {
  task: Task
  behaviour: FinishBehaviour
  result: FinishResult | null
  /** True when the curating step was handed to the background. */
  deferred: boolean
}

/**
 * Raised when a finish must not proceed. Always thrown BEFORE the task is
 * marked complete, so the user can fix the problem and try again.
 */
export class FinishRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinishRefused'
  }
}

export async function finishTask(deps: FinishDeps, taskId: string, signal?: AbortSignal): Promise<FinishOutcome> {
  const task = deps.storage.getTask(taskId)
  if (!task) throw new Error('task not found')
  const types = deps.storage.listTypes()
  const def = effectiveType(types, task)
  if (!def) throw new FinishRefused(`no type definition resolves for task "${task.title}"`)

  const behaviour = resolveBehaviour(def)

  // 1. Declared inputs gate Finish (spec task-types).
  const missing = hasUnfilledRequiredInputs(def, task.inputs)
  if (missing.length > 0) {
    throw new FinishRefused(`cannot finish: missing required input(s): ${missing.map((f) => f.label).join(', ')}`)
  }

  // 2. Resolve + confine the destination, and make sure it is usable — all
  //    before the task is marked complete.
  //    complete-only writes nothing, so it needs neither a destination nor a
  //    store; supplying one is a type-configuration error, refused at save.
  let store: ArtifactStorePort | null = null
  let destination: ReturnType<typeof resolveArtifact> | null = null

  if (behaviour !== 'complete-only') {
    const declared = declaredDestination(def)
    store = deps.storeFor(declared)
    destination = resolveArtifact(deps.paths, declared, deps.wikiRoot(), task.title, task.id)
    if (!destination.inside) {
      // Refuse rather than write to an unintended location (FR-006).
      throw new FinishRefused(
        `refusing to finish: the artifact would be written outside the destination root (${declared.rootPath ?? 'wiki'}) — re-point the destination in Settings`
      )
    }
    // A per-task target override (a wiki destination lets the user name the
    // note) is confined the same way, and refused rather than defaulted: a
    // stored path that no longer resolves — the wiki moved — must be surfaced
    // while the task is still actionable, never silently replaced.
    const override = deps.taskTargetOverride?.(task)
    if (override && !confineOverride(deps.paths, declared, deps.wikiRoot(), override)) {
      throw new FinishRefused(
        `"${override}" is outside the destination (${declared.rootPath ?? 'the wiki'}) — re-point it in the task's inputs`
      )
    }
    // prepare() rejects a missing or unwritable destination, so the failure
    // surfaces while the task is still actionable.
    await store.prepare(destination)
  }

  const note = deps.storage.getNotes(taskId)
  const activity =
    behaviour === 'deposit-then-curate'
      ? // The curating job owns the record for this behaviour (it does the
        // deposit), matching the flow the wiki ingestion has always had.
        null
      : deps.storage.createActivity({ taskId: task.id, taskTitle: task.title, depositFiles: [] })

  const ctx: FinishContext = {
    task,
    typeDef: def,
    destination,
    workingContent: note?.content ?? '',
    declaredInputs: task.inputs,
    // Only reached by 'complete-only', which writes nothing.
    store: store ?? deps.storeFor({ store: 'folder', rootPath: null, subdir: '' }),
    session: deps.session,
    clock: deps.clock,
    signal: signal ?? new AbortController().signal,
    onStep: (label, progress) => {
      deps.notifier.progress(label, progress)
      if (activity) deps.storage.updateActivity(activity.id, { state: 'running' })
    },
    summary: renderSummary(deps, taskId),
    attachmentPath: typeof task.inputs.filePath === 'string' ? task.inputs.filePath : undefined
  }

  // 3. Perform the behaviour.
  if (behaviour === 'deposit-then-curate') {
    // Deposit-first is preserved: the raw material is copied synchronously and
    // survives any later failure of the curating agent.
    const deposited = await ctx.store.deposit(destination!, {
      taskId: task.id,
      title: task.title,
      content: ctx.workingContent,
      summary: ctx.summary,
      attachmentPath: ctx.attachmentPath
    })
    const completed = markComplete(deps, task)
    deps.enqueueCurate(completed, deposited.files)
    deps.notifier.toast('Task finished — the assistant is writing it up', { view: 'activity' })
    return { task: completed, behaviour, result: null, deferred: true }
  }

  let result: FinishResult
  try {
    result = await FINISH_STRATEGIES[behaviour](ctx)
  } catch (e: any) {
    // The artifact step failed. The task stays incomplete and the user's work
    // is untouched, so the finish is retriable without retyping (FR-027).
    const message = e?.message ?? String(e)
    if (activity) {
      deps.storage.updateActivity(activity.id, {
        state: 'failed',
        error: message,
        finishedAt: deps.clock.nowIso()
      })
    }
    throw new FinishRefused(message)
  }

  // 4. Only now is the task complete.
  const completed = markComplete(deps, task)

  if (activity) {
    deps.storage.updateActivity(activity.id, {
      state: 'done',
      touchedFiles: result.touchedFiles,
      finishedAt: deps.clock.nowIso(),
      error: result.assistantError ?? null
    })
  }
  if (result.artifactPath) {
    deps.notifier.toast(`Finished — filed to ${result.artifactPath}`, { view: 'activity' })
  }
  if (result.assistantError) {
    // Reported, never presented as success (FR-024's spirit: a failure the
    // user is not told about is a failure they will discover later).
    deps.notifier.toast(`Filed as written — the assistant step failed: ${result.assistantError}`, { view: 'activity' })
  }

  return { task: completed, behaviour, result, deferred: false }
}

// ---- helpers ----

/**
 * The behaviour a type declares. A type that declares none falls back to what
 * its category did historically (so no existing task changes behaviour), and a
 * `meeting` type — which has no history — is refused rather than guessed at.
 */
export function resolveBehaviour(def: TaskTypeDef): FinishBehaviour {
  const declared = declaredWorkflow(def)
  if (!declared.finishBehaviour) {
    throw new FinishRefused(
      `type "${def.label}" does not declare a finish behaviour — set one in Settings before finishing`
    )
  }
  return declared.finishBehaviour
}

function declaredDestination(def: TaskTypeDef): Destination {
  const declared = declaredWorkflow(def)
  if (!declared.destination) {
    throw new FinishRefused(`type "${def.label}" writes an artifact but declares no destination — set one in Settings`)
  }
  return declared.destination
}

function markComplete(deps: FinishDeps, task: Task): Task {
  return deps.storage.updateTask(task.id, {
    completed: true,
    completedAt: deps.clock.nowIso(),
    // Completing a task cancels its alarm (spec task-notifications).
    alarmAt: null
  })
}

function renderSummary(deps: FinishDeps, taskId: string): string | undefined {
  const p = deps.storage.getPreprocess(taskId)
  if (!p) return undefined
  return `# AI Pre-process Summary — ${p.taskId}

## Generated working prompt
${p.generatedPrompt || '(none)'}

## Summary
${p.summary || '(none)'}

## Activity suggestions
${p.suggestions.map((s) => `- ${s}`).join('\n') || '(none)'}
`
}

export { writesArtifact }
