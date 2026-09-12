import type { TaskTypeDef, TypeInputField } from '../../shared/types'
import { CATEGORIES, isCategory, isFinishBehaviour, writesArtifact } from './categories'
import { validateDestination } from './destination'
import type { PathPort } from '../ports/paths'
import { legacyWorkflow } from './taskType'

// The single validation point for task inputs and type definitions
// (contracts/type-definition.md). All three write paths — create, update, and
// the finish gate — run through here, so a rule cannot be enforced on one path
// and forgotten on another.

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const ok = (errors: string[]): ValidationResult => ({ ok: errors.length === 0, errors })

/**
 * Shape validation for a task's inputs against a type's declared fields: every
 * value must be a string (or absent), unknown keys are rejected, and select
 * fields must carry one of their declared option values. `required` presence
 * is NOT enforced here — Finish gates on it separately.
 */
export function validateInputs(def: TaskTypeDef, inputs: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  const declared = new Map(def.inputSchema.map((f) => [f.key, f]))
  for (const [key, value] of Object.entries(inputs ?? {})) {
    const field = declared.get(key)
    if (!field) {
      errors.push(`unknown input "${key}" for type "${def.key}"`)
      continue
    }
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      errors.push(`input "${key}" must be a string`)
      continue
    }
    if (field.type === 'select' && field.options && value !== '') {
      if (!field.options.some((o) => o.value === value)) {
        errors.push(`input "${key}" must be one of: ${field.options.map((o) => o.value).join(', ')}`)
      }
    }
  }
  return ok(errors)
}

/**
 * Required + immutable checks for a write where old inputs may already exist.
 * Immutable fields (the jira source kind) cannot change once set.
 */
export function validateInputsForWrite(
  def: TaskTypeDef,
  inputs: Record<string, unknown>,
  previous: Record<string, unknown>
): ValidationResult {
  const errors = [...validateInputs(def, inputs).errors]
  for (const field of def.inputSchema) {
    if (field.immutable && previous[field.key] !== undefined && previous[field.key] !== inputs[field.key]) {
      // Only locked once it has a value (creation picks it).
      if (typeof previous[field.key] === 'string' && previous[field.key] !== '') {
        errors.push(`input "${field.key}" cannot be changed after creation`)
      }
    }
  }
  return ok(errors)
}

/** Finish gating: the declared inputs of a type that are still unfilled. */
export function hasUnfilledRequiredInputs(def: TaskTypeDef, inputs: Record<string, unknown>): TypeInputField[] {
  return def.inputSchema.filter((f) => {
    if (!f.required || f.inert) return false
    const v = inputs[f.key]
    return typeof v !== 'string' || v.trim() === ''
  })
}

export interface TypeDefValidationContext {
  paths: PathPort
  /** The row already stored under `def.key`, or null when there is none. */
  existing: TaskTypeDef | null
  mode: 'create' | 'update'
}

/**
 * Type-definition validation (contracts/type-definition.md "Validation rules").
 *
 * A type's declared workflow is checked here and nowhere else. Note what this
 * does NOT do: it never substitutes a behaviour for an unrecognised one. An
 * unknown `finishBehaviour` is rejected — silently defaulting would mean a
 * user's declared behaviour could be replaced by one they never chose.
 */
export function validateTypeDefinition(def: TaskTypeDef, ctx: TypeDefValidationContext): ValidationResult {
  const errors: string[] = []

  if (!/^[a-z0-9_]{2,32}$/.test(def.key)) {
    errors.push('key must be 2–32 chars of lowercase letters, digits, underscore')
  }
  if (!isCategory(def.kind)) {
    errors.push(`kind must be one of: ${CATEGORIES.join(', ')}`)
  }
  if (!def.label?.trim()) errors.push('label is required')
  if (!def.emoji?.trim()) errors.push('emoji is required')
  if (!Array.isArray(def.inputSchema)) errors.push('inputSchema must be an array')
  const seen = new Set<string>()
  for (const f of def.inputSchema ?? []) {
    if (!f.key || seen.has(f.key)) errors.push(`duplicate or empty input field key "${f.key ?? ''}"`)
    seen.add(f.key)
    if (!f.label) errors.push(`input "${f.key}" needs a label`)
  }

  // --- declared finish behaviour ---
  const declared = def.finishBehaviour as unknown
  if (declared === undefined || declared === null || declared === '') {
    // Not declared at all: fall back to what this category did historically.
    // `meeting` has no history, so an undeclared Meeting type is refused.
    if (isCategory(def.kind) && legacyWorkflow(def.kind) === null) {
      errors.push(`a "${def.kind}" type must declare a finishBehaviour`)
    }
  } else if (!isFinishBehaviour(declared)) {
    errors.push(`finishBehaviour must be one of: complete-only, file-as-is, polish-then-file, deposit-then-curate`)
  } else {
    // complete-only writes nothing, so a destination is a contradiction;
    // every writing behaviour needs one.
    if (declared === 'complete-only' && def.destination) {
      errors.push('a complete-only type must not declare a destination')
    }
    if (writesArtifact(declared) && !def.destination) {
      errors.push(`a "${declared}" type must declare a destination`)
    }
  }
  for (const e of validateDestination(ctx.paths, def.destination)) errors.push(e)

  // --- grants ---
  if (def.grants) {
    for (const list of [def.grants.skills, def.grants.toolServers]) {
      if (list === undefined) continue
      if (!Array.isArray(list)) {
        errors.push('grant entries must be arrays of names')
        continue
      }
      if (list.some((n) => typeof n !== 'string' || !n.trim())) {
        errors.push('grant names must be non-empty strings')
      }
    }
  }

  // --- create/update identity rules ---
  if (ctx.mode === 'create' && ctx.existing) {
    errors.push(
      ctx.existing.isBuiltin
        ? `"${def.key}" is a built-in type key`
        : `a type with key "${def.key}" already exists`
    )
  }
  if (ctx.mode === 'update') {
    if (!ctx.existing) {
      errors.push(`type "${def.key}" not found`)
    } else if (ctx.existing.isBuiltin) {
      // FR-017: a built-in's category and behaviour are fixed; its display
      // fields remain editable (the merge happens in the service).
      if (def.kind !== ctx.existing.kind) errors.push('built-in types cannot change kind')
      if (def.finishBehaviour && def.finishBehaviour !== ctx.existing.finishBehaviour) {
        errors.push('built-in types cannot change finishBehaviour')
      }
    }
  }

  return ok(errors)
}
