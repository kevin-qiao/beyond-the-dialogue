import type { Destination, FinishBehaviour, Task, TaskTypeDef } from '../../shared/types'
import type { TaskCategory } from './categories'

// Effective-type resolution and the workflow a type declares.
//
// The category retains exactly two responsibilities (contracts/type-definition.md):
// pre-processing dispatch and the working area. Finish behaviour and
// destination are explicit declarations, never inferred from the category —
// except when a type does not declare them at all, which only happens for
// rows and callers that predate the declaration. Those get the workflow their
// category had historically, so no existing task changes behaviour (SC-002).

/**
 * The workflow a category had before it became a declaration. Used only as a
 * fallback for a type that declares no `finishBehaviour`.
 *
 * Returns `null` for `meeting`: it is a new category with no historical
 * behaviour to preserve, so an undeclared Meeting type is a configuration
 * error rather than a silent guess.
 */
export function legacyWorkflow(
  category: TaskCategory
): { finishBehaviour: FinishBehaviour; destination?: Destination } | null {
  if (category === 'learning') {
    // Exactly today's Learning flow (FR-003), minus its location: there is no
    // global wiki directory and no built-in default, so this fallback declares
    // WHERE-IN-the-wiki but not WHICH wiki. A learning type carrying a null
    // root is refused at Finish until it names a directory.
    return {
      finishBehaviour: 'deposit-then-curate',
      destination: { store: 'wiki', rootPath: null, subdir: 'learning-notes' }
    }
  }
  if (category === 'plain' || category === 'jira') {
    return { finishBehaviour: 'complete-only' }
  }
  return null
}

/**
 * The type definition that governs a task: a custom type reference wins over
 * the built-in `type` when it still exists, otherwise the built-in.
 *
 * Pure — the caller supplies the registry, which is what makes it usable from
 * the renderer and from a service alike.
 */
export function effectiveType(
  types: readonly TaskTypeDef[],
  task: Pick<Task, 'type' | 'customTypeKey'>
): TaskTypeDef | null {
  if (task.customTypeKey) {
    const custom = types.find((t) => t.key === task.customTypeKey)
    if (custom) return custom
  }
  return types.find((t) => t.key === task.type) ?? null
}

/**
 * The behaviour category that governs a task's pre-processing and working
 * area. Falls back to `plain` so a caller always gets a usable dispatch key
 * even when the registry is empty.
 */
export function effectiveCategory(
  types: readonly TaskTypeDef[],
  task: Pick<Task, 'type' | 'customTypeKey'>
): TaskCategory {
  return (effectiveType(types, task)?.kind ?? 'plain') as TaskCategory
}

/** The workflow a type declares, filling in the category's historical defaults. */
export function declaredWorkflow(def: TaskTypeDef): {
  finishBehaviour: FinishBehaviour | null
  destination: Destination | undefined
} {
  if (def.finishBehaviour) return { finishBehaviour: def.finishBehaviour, destination: def.destination }
  const legacy = legacyWorkflow(def.kind)
  if (!legacy) return { finishBehaviour: null, destination: def.destination }
  return { finishBehaviour: legacy.finishBehaviour, destination: def.destination ?? legacy.destination }
}
