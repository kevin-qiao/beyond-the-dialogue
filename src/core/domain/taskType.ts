import type { Destination, FinishBehaviour, Task, TaskTypeDef } from '../../shared/types'

// Effective-type resolution and the workflow a type declares.
//
// Feature 002 retired the category vocabulary entirely (research D1): a Type's
// Family, declared inputs, assistant instruction, finish behaviour and
// destination are the sole determinant of what its assistance does (FR-012).
//
// The old `legacyWorkflow` fallback — "if a type declares no behaviour, use the
// behaviour its CATEGORY historically had" — is deleted with the categories.
// There is no longer a category to infer from, and Principle I forbids
// inferring a behaviour from a type key or name. A Type that declares no
// behaviour is a configuration error surfaced by validation, not a silent
// guess. `effectiveCategory` (the old dispatch key) is likewise gone — the
// working area now reads the Family (src/core/domain/workingArea.ts).

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
 * The workflow a type declares. Since feature 002 the declaration is read
 * outright — there is no historical fallback. `finishBehaviour` is required on
 * the shape, so a well-formed Type always yields a behaviour; the null case
 * remains only for a payload that failed validation upstream (which the
 * caller's finish path refuses with a localized code, never a guess).
 */
export function declaredWorkflow(def: TaskTypeDef): {
  finishBehaviour: FinishBehaviour | null
  destination: Destination | undefined
} {
  return { finishBehaviour: def.finishBehaviour, destination: def.destination }
}
