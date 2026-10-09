import type { Settings, Task } from '../../shared/types'
import type { StoragePort, CreateTaskInput } from '../ports/storage'
import { effectiveCategory, effectiveType } from '../domain/taskType'
import { validateInputsForWrite, validateTaskWrite } from '../domain/validation'
import { preprocessInputHash } from '../domain/hashing'
import { LocalizedError } from '../i18n/issues'
import { hasPreprocess } from '../domain/preprocess'
import { isConfigured } from '../domain/config'
import { isAssistantEnabled } from '../domain/assistant'

// Task use cases: create, edit, and My Day membership.
//
// These were IPC handlers in src/main/index.ts, where the routing rules lived
// next to the transport and could only be exercised by launching Electron.
// The rules are the same; what changed is that they now take a StoragePort and
// are testable without a window.

/** Work the caller should hand to the background, decided by the service. */
export type BackgroundWork = 'suggestion' | 'preprocess'

export interface TaskMutationOutcome {
  task: Task
  /** Jobs to enqueue, in order. Empty for most edits. */
  enqueue: BackgroundWork[]
}

export function createTask(storage: StoragePort, args: CreateTaskInput): Task {
  // FR-001 at the core edge: a task without a title is refused in every
  // host, not just hidden by the renderer's form check.
  const titleV = validateTaskWrite({ title: args.title })
  if (!titleV.ok) throw new LocalizedError(titleV.errors)
  const types = storage.listTypes()
  const def = effectiveType(types, { type: args.type ?? 'plain', customTypeKey: args.customTypeKey ?? null })
  const inputs = args.inputs ?? {}
  if (def) {
    // Inputs are validated in exactly one place before persistence; the
    // renderer never writes arbitrary columns (design D1).
    const v = validateInputsForWrite(def, inputs, {})
    if (!v.ok) throw new LocalizedError(v.errors)
  }
  return storage.createTask({ ...args, inputs })
}

export interface UpdateTaskInput {
  id: string
  title?: string
  background?: string
  target?: string
  notes?: string
  /** null unassigns the task (FR-006); undefined leaves membership alone. */
  listId?: string | null
  type?: Task['type']
  customTypeKey?: string | null
  inputs?: Record<string, unknown>
}

/**
 * Edit a task. Returns the task plus whatever background work the edit
 * warrants, so the caller does no rule-evaluation of its own.
 *
 * Two rules live here rather than in a handler:
 *   - switching type discards inputs the new type does not declare (the
 *     renderer re-collects what carries over, so the values are not stranded);
 *   - a change to a *relevant* input while the task sits in My Day re-runs
 *     pre-processing, gated on the input hash so an unrelated edit does not.
 */
export function updateTask(storage: StoragePort, args: UpdateTaskInput, settings: Settings): TaskMutationOutcome {
  const before = storage.getTask(args.id)
  if (!before) throw new Error('task not found')
  // FR-001 applies to every write that names the title (FR-004: edit must
  // not be able to strip the one field a task cannot lose).
  if (args.title !== undefined) {
    const titleV = validateTaskWrite({ title: args.title })
    if (!titleV.ok) throw new LocalizedError(titleV.errors)
  }

  const patch: Partial<Task> = {
    title: args.title,
    background: args.background,
    target: args.target,
    notes: args.notes
  }
  // Only touch membership when the caller named it: `undefined` means "leave
  // it alone", `null` means "unassign" (FR-006).
  if (args.listId !== undefined) patch.listId = args.listId
  const typeChanged =
    (args.type !== undefined && args.type !== before.type) ||
    (args.customTypeKey !== undefined && (args.customTypeKey ?? null) !== before.customTypeKey)
  if (args.type !== undefined) patch.type = args.type
  if (args.customTypeKey !== undefined) patch.customTypeKey = args.customTypeKey ?? null

  if (typeChanged) {
    patch.inputs = {}
  } else if (args.inputs !== undefined) {
    const def = effectiveType(storage.listTypes(), before)
    if (def) {
      const v = validateInputsForWrite(def, args.inputs, before.inputs)
      if (!v.ok) throw new LocalizedError(v.errors)
    }
    patch.inputs = args.inputs
  }

  let task = storage.updateTask(args.id, patch)

  // A type change invalidates the old outputs wholesale; the stale results
  // belong to the previous type, so re-running is left to the My Day re-add.
  const inputsTouched = args.inputs !== undefined || args.title !== undefined || args.notes !== undefined
  if (!typeChanged && inputsTouched && shouldRerunPreprocess(storage, task, settings)) {
    task = storage.updateTask(task.id, { preprocessStatus: 'queued', preprocessError: null })
    return { task, enqueue: ['preprocess'] }
  }
  return { task, enqueue: [] }
}

/**
 * The hash gate (design D3): re-run only when a relevant input actually
 * changed, the task is still actionable in My Day, no run is in flight, and
 * the AI is configured.
 */
function shouldRerunPreprocess(storage: StoragePort, task: Task, settings: Settings): boolean {
  // Feature 001's switch (FR-015, research D1/D7): with the assistant off the
  // board never enqueues AI work — the returned enqueue is empty and no
  // preprocess_status is set, exactly as if the category had no pre-process.
  if (!isAssistantEnabled(settings)) return false
  const category = effectiveCategory(storage.listTypes(), task)
  if (!hasPreprocess(category) || !isConfigured(settings)) return false
  if (!task.inMyDay || task.completed) return false
  if (task.preprocessStatus === 'queued' || task.preprocessStatus === 'running') return false
  const def = effectiveType(storage.listTypes(), task)
  const newHash = preprocessInputHash(task, def)
  const consumed = storage.getPreprocess(task.id)?.inputsHash ?? ''
  return newHash !== consumed
}

/**
 * Add or remove a task from My Day. My Day is planning-only: a first add fires
 * the suggestion chips for a category with no pre-process, or that category's
 * pre-process for one that has it — never both, because the pre-process folds
 * its suggestions in.
 */
export function setMyDay(
  storage: StoragePort,
  id: string,
  inMyDay: boolean,
  settings: Settings
): TaskMutationOutcome {
  const before = storage.getTask(id)
  if (!before) throw new Error('task not found')
  let task = storage.updateTask(id, { inMyDay, myDayAddedAt: inMyDay ? new Date().toISOString() : null })

  const enqueue: BackgroundWork[] = []
  const firstAdd = inMyDay && !before.inMyDay
  // The switch decides whether a My Day add may reach the network at all
  // (FR-015): with it off, neither the plain-task suggestion (research D7 —
  // the one place a *board* interaction used to call a provider) nor any
  // pre-process is enqueued, and `preprocess_status` never flips to queued.
  if (firstAdd && isAssistantEnabled(settings)) {
    const category = effectiveCategory(storage.listTypes(), task)
    if (!hasPreprocess(category)) {
      enqueue.push('suggestion')
    } else if (isConfigured(settings)) {
      task = storage.updateTask(task.id, { preprocessStatus: 'queued', preprocessError: null })
      enqueue.push('preprocess')
    }
  }
  return { task, enqueue }
}
