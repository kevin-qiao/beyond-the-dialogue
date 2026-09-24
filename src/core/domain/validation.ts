import type { TaskTypeDef, TypeInputField } from '../../shared/types'
import { CATEGORIES, FINISH_BEHAVIOURS, isCategory, isFinishBehaviour, writesArtifact } from './categories'
import { validateDestination } from './destination'
import type { PathPort } from '../ports/paths'
import { legacyWorkflow } from './taskType'
import type { MessageIssue } from '../i18n/issues'

// The single validation point for task inputs and type definitions
// (contracts/type-definition.md). All three write paths — create, update, and
// the finish gate — run through here, so a rule cannot be enforced on one path
// and forgotten on another.
//
// Refusals are CODES, not sentences: the domain has no language and is compiled
// into both hosts, so it states what is wrong and the caller that owns a
// language phrases it (see src/core/i18n/issues.ts).

export interface ValidationResult {
  ok: boolean
  errors: MessageIssue[]
}

const ok = (errors: MessageIssue[]): ValidationResult => ({ ok: errors.length === 0, errors })

/**
 * Shape validation for a task's inputs against a type's declared fields: every
 * value must be a string (or absent), unknown keys are rejected, and select
 * fields must carry one of their declared option values. `required` presence
 * is NOT enforced here — Finish gates on it separately.
 */
export function validateInputs(def: TaskTypeDef, inputs: Record<string, unknown>): ValidationResult {
  const errors: MessageIssue[] = []
  const declared = new Map(def.inputSchema.map((f) => [f.key, f]))
  for (const [key, value] of Object.entries(inputs ?? {})) {
    const field = declared.get(key)
    if (!field) {
      errors.push({ key: 'validation.unknownInput', params: { input: key, type: def.key } })
      continue
    }
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      errors.push({ key: 'validation.inputNotString', params: { input: key } })
      continue
    }
    if (field.type === 'select' && field.options && value !== '') {
      if (!field.options.some((o) => o.value === value)) {
        errors.push({
          key: 'validation.inputNotAnOption',
          params: { input: key, options: field.options.map((o) => o.value).join(', ') }
        })
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
        errors.push({ key: 'validation.inputImmutable', params: { input: field.key } })
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
  const errors: MessageIssue[] = []

  if (!/^[a-z0-9_]{2,32}$/.test(def.key)) {
    errors.push({ key: 'validation.keyFormat' })
  }
  if (!isCategory(def.kind)) {
    errors.push({ key: 'validation.kindUnknown', params: { kinds: CATEGORIES.join(', ') } })
  }
  if (!def.label?.trim()) errors.push({ key: 'validation.labelRequired' })
  if (!def.emoji?.trim()) errors.push({ key: 'validation.emojiRequired' })
  if (!Array.isArray(def.inputSchema)) errors.push({ key: 'validation.inputSchemaNotArray' })
  const seen = new Set<string>()
  for (const f of def.inputSchema ?? []) {
    if (!f.key || seen.has(f.key)) errors.push({ key: 'validation.fieldKeyInvalid', params: { key: f.key ?? '' } })
    seen.add(f.key)
    if (!f.label) errors.push({ key: 'validation.fieldNeedsLabel', params: { key: f.key } })
  }

  // --- declared finish behaviour ---
  const declared = def.finishBehaviour as unknown
  if (declared === undefined || declared === null || declared === '') {
    // Not declared at all: fall back to what this category did historically.
    // `meeting` has no history, so an undeclared Meeting type is refused.
    if (isCategory(def.kind) && legacyWorkflow(def.kind) === null) {
      errors.push({ key: 'validation.mustDeclareBehaviour', params: { kind: def.kind } })
    }
  } else if (!isFinishBehaviour(declared)) {
    errors.push({ key: 'validation.behaviourUnknown', params: { behaviours: FINISH_BEHAVIOURS.join(', ') } })
  } else {
    // complete-only writes nothing, so a destination is a contradiction;
    // every writing behaviour needs one.
    if (declared === 'complete-only' && def.destination) {
      errors.push({ key: 'validation.completeOnlyNoDestination' })
    }
    if (writesArtifact(declared) && !def.destination) {
      errors.push({ key: 'validation.needsDestination', params: { behaviour: declared } })
    }
  }
  for (const issue of validateDestination(ctx.paths, def.destination)) errors.push(issue)

  // --- grants ---
  if (def.grants) {
    for (const list of [def.grants.skills, def.grants.toolServers]) {
      if (list === undefined) continue
      if (!Array.isArray(list)) {
        errors.push({ key: 'validation.grantsNotArrays' })
        continue
      }
      if (list.some((n) => typeof n !== 'string' || !n.trim())) {
        errors.push({ key: 'validation.grantNamesEmpty' })
      }
    }
  }

  // --- create/update identity rules ---
  if (ctx.mode === 'create' && ctx.existing) {
    errors.push({
      key: ctx.existing.isBuiltin ? 'validation.keyIsBuiltin' : 'validation.keyExists',
      params: { key: def.key }
    })
  }
  if (ctx.mode === 'update') {
    if (!ctx.existing) {
      errors.push({ key: 'validation.typeNotFound', params: { key: def.key } })
    } else if (ctx.existing.isBuiltin) {
      // FR-017: a built-in's category and behaviour are fixed; its display
      // fields remain editable (the merge happens in the service).
      if (def.kind !== ctx.existing.kind) errors.push({ key: 'validation.builtinKindFixed' })
      if (def.finishBehaviour && def.finishBehaviour !== ctx.existing.finishBehaviour) {
        errors.push({ key: 'validation.builtinBehaviourFixed' })
      }
    }
  }

  return ok(errors)
}
