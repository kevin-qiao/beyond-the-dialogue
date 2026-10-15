import type { Destination, FinishMode, FinishReport, Task, TaskTypeDef } from '../../shared/types'
import type { PathPort } from '../ports/paths'
import type { ArtifactStorePort } from '../ports/artifactStore'
import type { AgentSessionPort } from '../ports/agent'
import type { ClockPort } from '../ports/clock'
import type { NotifierPort } from '../ports/notifier'
import type { StoragePort } from '../ports/storage'
import { confineOverride, resolveArtifact } from '../domain/destination'
import { declaredWorkflow, effectiveType } from '../domain/taskType'
import { hasUnfilledRequiredInputs } from '../domain/validation'
import {
  FINISH_STRATEGIES,
  fileAsIs,
  writesArtifact,
  type FinishBehaviour,
  type FinishContext,
  type FinishResult
} from '../domain/finish'
import { message, type Language } from '../i18n'
import { isLocalizedError, LocalizedError, type IssueList } from '../i18n/issues'

// Finish orchestration: the one place a task's completion is decided.
//
// Dispatch is on the type's DECLARED behaviour (Principle I), and — since
// feature 002 — on the MODE the user chose at the finish step (research D8):
// 'assisted' lets the organize step run, 'as-written' files the user's exact
// words and constructs no session at all. The Type's declaration sets the
// default the UI presents.
//
// Ordering is the load-bearing part. A finish that cannot succeed must fail
// while the task is still actionable, so validation and the destination check
// happen BEFORE anything is marked complete:
//
//   validate inputs → blank-draft refusal → resolve + confine destination
//   → prepare it → write → mark complete, clear alarm → report
//
// The off state (FR-021): while the assistant switch is off or no model is
// configured, the resolved mode is 'as-written' — every filing behaviour
// stays reachable on that path, the board never blocks on AI (FR-006), and no
// session is constructed. Feature 001's `assistant.disabled` finish refusal is
// deleted outright: refusing to file the user's own words because the
// assistant is off was the one flow the board's promise could not keep.
//
// Nothing here deletes, moves, or overwrites an existing artifact, and no
// assistant step inside a finish receives a plugin grant (purpose 'confined').

export interface FinishDeps {
  /** The language the step labels and toasts are produced in. */
  language: Language
  /**
   * The assistant-runtime switch. While it is off, the finish mode is forced
   * to 'as-written' and no session is constructed (FR-021) — the filing
   * behaviours all stay reachable, on the path that needs no AI.
   */
  assistantEnabled: boolean
  paths: PathPort
  storage: StoragePort
  /** The artifact store for a destination's `store` value. */
  storeFor: (dest: Destination) => ArtifactStorePort
  session: AgentSessionPort
  clock: ClockPort
  notifier: NotifierPort
  /**
   * Hand a `deposit-then-curate` finish to the background: the deposit is the
   * part that must survive, and the curating agent is long-running work the
   * user should be able to keep working through.
   */
  enqueueCurate: (task: Task, depositFiles: string[]) => void
  /**
   * A per-task override of where the artifact goes, when the destination's
   * store allows the user to name it (a wiki destination lets a task set its
   * own note path). Kept as a hook so the finish service does not learn any
   * one store's input vocabulary.
   */
  taskTargetOverride?: (task: Task) => string | undefined
}

export interface FinishOutcome {
  task: Task
  behaviour: FinishBehaviour
  result: FinishResult | null
  /** True when the curating step was handed to the background. */
  deferred: boolean
  /** The mode that actually ran, after the declaration and the off-state
   *  forcing resolved it (D8). */
  mode: FinishMode
  /** The contract report — `tasks:finish`'s result (T019): where the filed
   *  copy went and which path ran (FR-003). */
  report: FinishReport
}

/**
 * Raised when a finish must not proceed. Always thrown BEFORE the task is
 * marked complete, so the user can fix the problem and try again.
 */
/** A refusal the user must read. Carries codes; the transport phrases them. */
export class FinishRefused extends LocalizedError {
  constructor(issues: IssueList) {
    super(issues)
    this.name = 'FinishRefused'
  }
}

/**
 * The mode the UI presents as selected, from the declaration alone (D8): an
 * organize-capable Type defaults to assisted; every other Type — including a
 * `file-as-is` one — defaults to as-written. No branch on a Type key: the
 * behaviour declaration is the axis.
 */
export function defaultFinishMode(def: TaskTypeDef): FinishMode {
  return declaredWorkflow(def).finishBehaviour === 'polish-then-file' ? 'assisted' : 'as-written'
}

/**
 * The mode that will actually run. The off state wins over any request
 * (FR-021): while the switch is off or no model is configured, only the
 * as-written path exists and no session is constructed — the forced path is
 * the same one the user could have chosen, which is what makes the guarantee
 * structural rather than a refusal.
 */
export function resolveFinishMode(
  def: TaskTypeDef,
  requested: FinishMode | undefined,
  assistantAvailable: boolean
): FinishMode {
  if (!assistantAvailable) return 'as-written'
  return requested ?? defaultFinishMode(def)
}

export interface FinishOptions {
  /** The user's choice at the finish step; the declaration sets the default. */
  mode?: FinishMode
}

export async function finishTask(
  deps: FinishDeps,
  taskId: string,
  opts?: FinishOptions,
  signal?: AbortSignal
): Promise<FinishOutcome> {
  const task = deps.storage.getTask(taskId)
  if (!task) throw new Error('task not found')
  const types = deps.storage.listTypes()
  const def = effectiveType(types, task)
  if (!def) throw new FinishRefused([{ key: 'finish.noTypeDefinition', params: { title: task.title } }])

  const behaviour = resolveBehaviour(def)
  const assistantAvailable = deps.assistantEnabled && deps.session.isAvailable()
  const mode = resolveFinishMode(def, opts?.mode, assistantAvailable)

  // 1. Declared inputs gate Finish (spec task-types).
  const missing = hasUnfilledRequiredInputs(def, task.inputs)
  if (missing.length > 0) {
    throw new FinishRefused([
      { key: 'finish.missingInputs', params: { fields: missing.map((f) => f.label).join(', ') } }
    ])
  }

  const note = deps.storage.getNotes(taskId)
  const workingContent = note?.content ?? ''
  const attachmentPath = typeof task.inputs.filePath === 'string' && task.inputs.filePath.trim() ? task.inputs.filePath : undefined

  // 2. A blank working area refuses while the task is still actionable
  //    (US1-AC6): nothing is filed, and the app explains that there is no
  //    written content yet. A deposit with an attachment still has material,
  //    so the refusal applies when there is nothing at all.
  if (writesArtifact(behaviour) && !workingContent.trim() && !attachmentPath) {
    throw new FinishRefused([{ key: 'document.empty' }])
  }

  // 3. Resolve + confine the destination, and make sure it is usable — all
  //    before the task is marked complete.
  //    complete-only writes nothing, so it needs neither a destination nor a
  //    store; supplying one is a type-configuration error, refused at save.
  let store: ArtifactStorePort | null = null
  let destination: ReturnType<typeof resolveArtifact> | null = null

  if (behaviour !== 'complete-only') {
    const declared = declaredDestination(def)
    // Both stores declare their own location and there is no default (Q1):
    // a blank root is the guided refusal, phrased with the contract's
    // destination.not_configured code, whichever store the Type declares.
    if (!(declared.rootPath ?? '').trim()) {
      throw new FinishRefused([{ key: 'destination.notConfigured' }])
    }
    store = deps.storeFor(declared)
    destination = resolveArtifact(deps.paths, declared, task.title, task.id)
    if (!destination.inside) {
      // Refuse rather than write to an unintended location (FR-007).
      throw new FinishRefused([
        { key: 'finish.outsideDestination', params: { root: declared.rootPath ?? '' } }
      ])
    }
    // A per-task target override (a wiki destination lets the user name the
    // note) is confined the same way, and refused rather than defaulted: a
    // stored path that no longer resolves — the collection moved — must be
    // surfaced while the task is still actionable, never silently replaced.
    const override = deps.taskTargetOverride?.(task)
    if (override && !confineOverride(deps.paths, declared, override)) {
      throw new FinishRefused([
        { key: 'finish.overrideOutside', params: { path: override, root: declared.rootPath ?? 'the collection' } }
      ])
    }
    // prepare() rejects a missing or unwritable destination
    // (destination.unreachable / store-specific codes), so the failure
    // surfaces while the task is still actionable.
    await store.prepare(destination)
  }

  const activity =
    behaviour === 'deposit-then-curate'
      ? // The curating job owns the record for this behaviour (it does the
        // deposit), matching the flow the knowledge base has always had.
        null
      : deps.storage.createActivity({ taskId: task.id, taskTitle: task.title, depositFiles: [] })

  const ctx: FinishContext = {
    task,
    language: deps.language,
    typeDef: def,
    destination,
    workingContent,
    declaredInputs: task.inputs,
    // Only reached by 'complete-only', which writes nothing.
    store: store ?? deps.storeFor({ store: 'folder', rootPath: '', subdir: '' }),
    session: deps.session,
    clock: deps.clock,
    signal: signal ?? new AbortController().signal,
    onStep: (label, progress) => {
      deps.notifier.progress(label, progress)
      if (activity) deps.storage.updateActivity(activity.id, { state: 'running' })
    },
    // No preprocess summary (D4): a deposit carries the user's own material —
    // the draft and the optional attachment — never a stale engine block.
    attachmentPath
  }

  // 4. Perform the behaviour.
  if (behaviour === 'deposit-then-curate') {
    // Deposit-first is preserved: the raw material is copied synchronously and
    // survives any later failure of the curating agent.
    const deposited = await ctx.store.deposit(destination!, {
      taskId: task.id,
      title: task.title,
      content: ctx.workingContent,
      attachmentPath: ctx.attachmentPath
    })
    const completed = markComplete(deps, task)
    deps.enqueueCurate(completed, deposited.files)
    // While off or unconfigured the curation will not run (its handler is
    // registered only while the switch is on): the report says so plainly
    // rather than promising a background step that cannot start (FR-019).
    if (assistantAvailable) {
      deps.notifier.toast(message(deps.language, 'toast.finishDeferred'), { view: 'activity' })
    } else {
      deps.notifier.toast(message(deps.language, 'toast.depositOnly'), { view: 'activity' })
    }
    return {
      task: completed,
      behaviour,
      result: null,
      deferred: true,
      mode,
      report: {
        ok: true,
        path: 'deposited',
        ...(assistantAvailable ? {} : { assistantStep: 'skipped' as const })
      }
    }
  }

  // The mode decides the strategy for an organize-capable Type: 'as-written'
  // files the exact words and NEVER touches the session seam — the guarantee
  // that the app will not silently rewrite the user's prose does not depend
  // on a failure path (D8's rationale).
  const strategy = behaviour === 'polish-then-file' && mode === 'as-written' ? fileAsIs : FINISH_STRATEGIES[behaviour]

  let result: FinishResult
  try {
    result = await strategy(ctx)
  } catch (e: any) {
    // The artifact step failed. The task stays incomplete and the user's work
    // is untouched, so the finish is retriable without retyping.
    //
    // A refusal that already carries codes keeps them, so it arrives localised.
    // Anything else — an adapter's own error, an agent failure — has no codes to
    // give, so it is kept whole inside a frame that says what step failed. The
    // activity record keeps the raw text either way: it is a record of what
    // happened, and this is the only place that text exists.
    const refused = isLocalizedError(e) ? e : new FinishRefused([{ key: 'finish.artifactFailed', params: { error: e?.message ?? String(e) } }])
    if (activity) {
      deps.storage.updateActivity(activity.id, {
        state: 'failed',
        error: e?.message ?? String(e),
        finishedAt: deps.clock.nowIso()
      })
    }
    throw refused
  }

  // 5. Only now is the task complete.
  const completed = markComplete(deps, task)

  if (activity) {
    deps.storage.updateActivity(activity.id, {
      state: 'done',
      touchedFiles: result.touchedFiles,
      finishedAt: deps.clock.nowIso(),
      error: result.assistantError ?? null
    })
  }

  const report = reportFor(behaviour, mode, result, def)
  if (result.artifactPath) {
    // FR-003: the report names where the filed copy went AND which path ran.
    deps.notifier.toast(
      message(
        deps.language,
        report.path === 'organized' ? 'toast.filedOrganized' : 'toast.filedAsWritten',
        { path: result.artifactPath }
      ),
      { view: 'activity' }
    )
  }
  if (result.assistantError) {
    // Reported, never presented as success: a failure the user is not told
    // about is a failure they will discover later.
    deps.notifier.toast(message(deps.language, 'toast.filedUnpolished', { error: result.assistantError ?? '' }), {
      view: 'activity'
    })
  } else if (behaviour === 'polish-then-file' && mode === 'as-written' && !assistantAvailable && deps.assistantEnabled === false) {
    // US1-AC4: with the switch off the app plainly says the organizing step
    // did not run — the filing succeeded, the step was skipped.
    deps.notifier.toast(message(deps.language, 'toast.organizeSkipped'), { view: 'activity' })
  }

  return { task: completed, behaviour, result, deferred: false, mode, report }
}

/** The contract report from what actually happened (contracts table). */
function reportFor(behaviour: FinishBehaviour, mode: FinishMode, result: FinishResult, def: TaskTypeDef): FinishReport {
  const artifact = result.artifactPath
    ? { path: result.artifactPath, store: (declaredWorkflow(def).destination?.store ?? 'folder') }
    : undefined
  if (behaviour === 'polish-then-file') {
    if (mode === 'as-written') {
      // Chosen or forced: the exact words were filed, no session ran.
      return { ok: true, ...(artifact ? { artifact } : {}), path: 'as-written', assistantStep: 'skipped' }
    }
    return result.assistantStep === 'succeeded'
      ? { ok: true, ...(artifact ? { artifact } : {}), path: 'organized', assistantStep: 'ran' }
      : // The organize step failed (or degraded): what was FILED is the user's
        // words as written, and the step is honestly reported failed (FR-005).
        { ok: true, ...(artifact ? { artifact } : {}), path: 'as-written', assistantStep: 'failed' }
  }
  if (behaviour === 'file-as-is') {
    return { ok: true, ...(artifact ? { artifact } : {}), path: 'as-written', assistantStep: 'skipped' }
  }
  // complete-only writes nothing; 'as-written' is the honest path name — the
  // user's content stays exactly as it was.
  return { ok: true, path: 'as-written', assistantStep: 'skipped' }
}

// ---- helpers ----

/**
 * The behaviour a type declares. Feature 002 deleted both fallbacks that used
 * to live here: there is no category history to infer from (D1), and the
 * off-switch no longer gates the RESULT — while off, the mode resolver forces
 * the as-written path instead of refusing (FR-021 replaces 001's
 * `assistant.disabled` finish refusal outright).
 */
export function resolveBehaviour(def: TaskTypeDef): FinishBehaviour {
  const declared = declaredWorkflow(def)
  if (!declared.finishBehaviour) {
    throw new FinishRefused([{ key: 'finish.noBehaviour', params: { type: def.label } }])
  }
  return declared.finishBehaviour
}

function declaredDestination(def: TaskTypeDef): Destination {
  const declared = declaredWorkflow(def)
  if (!declared.destination) {
    throw new FinishRefused([{ key: 'finish.noDestination', params: { type: def.label } }])
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
