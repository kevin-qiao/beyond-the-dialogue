import type { Settings, Task } from '../../shared/types'
import type { StoragePort, CreateTaskInput } from '../ports/storage'
import { effectiveType } from '../domain/taskType'
import { validateInputsForWrite, validateTaskWrite } from '../domain/validation'
import { LocalizedError } from '../i18n/issues'

// Task use cases: create, edit, and My Day membership.
//
// These were IPC handlers in src/main/index.ts, where the routing rules lived
// next to the transport and could only be exercised by launching Electron.
// The rules are the same; what changed is that they now take a StoragePort and
// are testable without a window.
//
// Feature 002 (D4): the preprocess/suggestion engines are deleted. An edit or
// a My Day add no longer decides any background work — the spec asks for no
// automatic job when a task is added, and assistance now begins only where
// the user chooses it (finish, conversation). The mutation outcome keeps its
// shape (`enqueue` stays, always empty) so callers and tests read one honest
// contract rather than a half-used one.

/** Work the caller should hand to the background, decided by the service.
 *  With the POC engines retired, no task mutation enqueues any. */
export type BackgroundWork = never

export interface TaskMutationOutcome {
  task: Task
  /** Always empty since feature 002 — an edit never starts AI work by itself. */
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
 * Edit a task.
 *
 * The one rule that lives here rather than in a handler: switching type
 * discards inputs the new type does not declare (the renderer re-collects
 * what carries over, so the values are not stranded). What used to also live
 * here — the hash-gated pre-process re-run on relevant input changes — is
 * deleted with the engine (D4).
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

  const task = storage.updateTask(args.id, patch)
  return { task, enqueue: [] }
}

/**
 * Add or remove a task from My Day. Since feature 002 a first add starts no
 * job at all (D4): the pre-process and suggestion triggers belonged to the
 * retired engines, and the 002 spec asks for no automatic AI work on any
 * board interaction.
 */
export function setMyDay(
  storage: StoragePort,
  id: string,
  inMyDay: boolean,
  settings: Settings
): TaskMutationOutcome {
  const before = storage.getTask(id)
  if (!before) throw new Error('task not found')
  const task = storage.updateTask(id, { inMyDay, myDayAddedAt: inMyDay ? new Date().toISOString() : null })
  return { task, enqueue: [] }
}
