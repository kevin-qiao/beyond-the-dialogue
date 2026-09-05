import type { DatabaseSync } from 'node:sqlite'
import { deleteType, getType, listTypes, reassignTasksFromType, upsertType } from './db'
import type { Task, TaskKind, TaskTypeDef, TypeInputField } from '../shared/types'
import { KINDS } from '../shared/types'

// The workflow-type registry service (design D1/D2): CRUD over task_types,
// effective-type resolution for a task, and input validation against a type's
// declared inputSchema. Inputs are validated in exactly one place (here)
// before persistence — the renderer never writes arbitrary columns.

export function listTypeDefs(db: DatabaseSync): TaskTypeDef[] {
  return listTypes(db)
}

export function getTypeDef(db: DatabaseSync, key: string): TaskTypeDef | null {
  return getType(db, key)
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

// Shape validation for a task's inputs against a type's declared fields:
// every value must be a string (or absent), unknown keys are rejected, and
// select fields must carry one of their declared option values. `required`
// presence is NOT enforced here — Finish gates on it separately (spec:
// required inputs gate Finish, not save).
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
  return { ok: errors.length === 0, errors }
}

// Required + immutable checks for a write where old inputs may already exist
// (update path). Immutable fields (jira sourceKind) cannot change once set.
export function validateInputsForWrite(
  def: TaskTypeDef,
  inputs: Record<string, unknown>,
  previous: Record<string, unknown>
): ValidationResult {
  const base = validateInputs(def, inputs)
  const errors = [...base.errors]
  for (const field of def.inputSchema) {
    if (field.immutable && previous[field.key] !== undefined && previous[field.key] !== inputs[field.key]) {
      // Only locked once it has a value (creation picks it).
      if (typeof previous[field.key] === 'string' && previous[field.key] !== '') {
        errors.push(`input "${field.key}" cannot be changed after creation`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// Finish gating (spec task-types: "Required inputs gate Finish").
export function hasUnfilledRequiredInputs(def: TaskTypeDef, inputs: Record<string, unknown>): TypeInputField[] {
  return def.inputSchema.filter((f) => {
    if (!f.required || f.inert) return false
    const v = inputs[f.key]
    return typeof v !== 'string' || v.trim() === ''
  })
}

// Effective type definition for a task: a custom type reference wins over
// the built-in `type` when it still exists; otherwise the built-in. Falls
// back to the `plain` def so callers always get a resolvable behavior kind.
export function effectiveTypeDef(db: DatabaseSync, task: Pick<Task, 'type' | 'customTypeKey'>): TaskTypeDef | null {
  if (task.customTypeKey) {
    const custom = getType(db, task.customTypeKey)
    if (custom) return custom
  }
  return getType(db, task.type)
}

// Behavior kind dispatch key for a task (design D2).
export function effectiveKind(db: DatabaseSync, task: Pick<Task, 'type' | 'customTypeKey'>): TaskKind {
  return (effectiveTypeDef(db, task) ?? getType(db, 'plain'))?.kind ?? 'plain'
}

// ---- Type CRUD ----

function validateTypeDef(def: TaskTypeDef, db: DatabaseSync, mode: 'create' | 'update'): ValidationResult {
  const errors: string[] = []
  if (!/^[a-z0-9_]{2,32}$/.test(def.key)) errors.push('key must be 2–32 chars of lowercase letters, digits, underscore')
  if (!KINDS.includes(def.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`)
  if (!def.label?.trim()) errors.push('label is required')
  if (!def.emoji?.trim()) errors.push('emoji is required')
  if (!Array.isArray(def.inputSchema)) errors.push('inputSchema must be an array')
  const seen = new Set<string>()
  for (const f of def.inputSchema ?? []) {
    if (!f.key || seen.has(f.key)) errors.push(`duplicate or empty input field key "${f.key ?? ''}"`)
    seen.add(f.key)
    if (!f.label) errors.push(`input "${f.key}" needs a label`)
  }
  const existing = getType(db, def.key)
  if (mode === 'create' && existing) errors.push(`a type with key "${def.key}" already exists`)
  if (mode === 'update' && existing?.isBuiltin && def.kind !== existing.kind) {
    errors.push('built-in types cannot change kind')
  }
  return { ok: errors.length === 0, errors }
}

export function createTypeDef(db: DatabaseSync, def: TaskTypeDef): TaskTypeDef {
  const v = validateTypeDef({ ...def, isBuiltin: false }, db, 'create')
  if (!v.ok) throw new Error(v.errors.join('; '))
  const builtins = new Set(['plain', 'learning', 'jira'])
  if (builtins.has(def.key)) throw new Error(`"${def.key}" is a built-in type key`)
  return upsertType(db, { ...def, isBuiltin: false })
}

// Update: custom types fully editable; built-ins only presentation
// (label/emoji/description/color) — their kind and inputSchema are fixed.
export function updateTypeDef(db: DatabaseSync, def: TaskTypeDef): TaskTypeDef {
  const existing = getType(db, def.key)
  if (!existing) throw new Error(`type "${def.key}" not found`)
  const merged: TaskTypeDef = existing.isBuiltin
    ? { ...existing, label: def.label, emoji: def.emoji, description: def.description, color: def.color }
    : def
  const v = validateTypeDef(merged, db, 'update')
  if (!v.ok) throw new Error(v.errors.join('; '))
  return upsertType(db, merged)
}

// Delete: built-ins are never deletable (spec). Tasks referencing the type
// fall back to plain without losing core fields (spec scenario).
export function deleteTypeDef(db: DatabaseSync, key: string): void {
  const existing = getType(db, key)
  if (!existing) return
  if (existing.isBuiltin) throw new Error('built-in types cannot be removed')
  reassignTasksFromType(db, key)
  deleteType(db, key)
}

// ---- inputs change detection for preprocess re-runs (design D3) ----

// Stable hash over the inputs that drive a kind's pre-process. "Relevant"
// means the non-inert declared fields (skill/mcp placeholders don't change
// outputs). Title and notes are folded in since prompts include them. Used
// to gate re-runs when a task's inputs change while it sits in My Day (D3).
export function preprocessInputHash(task: Task, def: TaskTypeDef | null): string {
  const relevant = (def?.inputSchema ?? [])
    .filter((f) => !f.inert)
    .map((f) => f.key)
    .sort()
  const parts = [`title=${task.title}`, `notes=${task.notes}`]
  for (const k of relevant) parts.push(`${k}=${typeof task.inputs[k] === 'string' ? (task.inputs[k] as string) : ''}`)
  const s = parts.join('\n')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}