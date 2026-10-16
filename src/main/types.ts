import type { DatabaseSync } from 'node:sqlite'
import { deleteType, getType, listTypes, loadSettings, reassignTasksFromType, reconcileInputsForType, upsertType } from './db'
import { issuesToText } from './errors'
import type { Task, TaskTypeDef } from '../shared/types'
import { effectiveType } from '../core/domain/taskType'
import {
  hasUnfilledRequiredInputs,
  validateInputs as coreValidateInputs,
  validateInputsForWrite as coreValidateInputsForWrite,
  validateTypeDefinition,
  type ValidationResult
} from '../core/domain/validation'
import { nodePathPort } from './adapters/paths'

// The workflow-type registry service: db-bound wrappers over the pure domain
// rules in src/core/domain. The rules themselves live there so the renderer
// and a future host can share them; this module supplies the registry.
//
// Feature 002: `effectiveKind` is deleted with the category vocabulary (plan
// project structure — "effectiveTypeDef reads declarations; effectiveKind is
// deleted"); `preprocessInputHash` and the legacy-workflow normalization went
// with the preprocess engine (D4).

export type { ValidationResult }

export function listTypeDefs(db: DatabaseSync): TaskTypeDef[] {
  return listTypes(db)
}

export function getTypeDef(db: DatabaseSync, key: string): TaskTypeDef | null {
  return getType(db, key)
}

// ---- input validation (delegates to src/core/domain/validation.ts) ----

export const validateInputs = coreValidateInputs
export const validateInputsForWrite = coreValidateInputsForWrite
export { hasUnfilledRequiredInputs }

// ---- effective type resolution ----

// Effective type definition for a task: a custom type reference wins over the
// built-in `type` when it still exists; otherwise the built-in. Falls back to
// the `plain` def so callers always get a resolvable behavior kind.
export function effectiveTypeDef(db: DatabaseSync, task: Pick<Task, 'type' | 'customTypeKey'>): TaskTypeDef | null {
  if (task.customTypeKey) {
    const custom = getType(db, task.customTypeKey)
    if (custom) return custom
  }
  return getType(db, task.type)
}

// Pure variant, for callers that already hold the registry (renderer, services).
export { effectiveType }

// ---- type CRUD ----

export function createTypeDef(db: DatabaseSync, def: TaskTypeDef): TaskTypeDef {
  const existing = getType(db, def.key)
  const normalized = normalizeTypeDef(def, existing)
  const v = validateTypeDefinition(normalized, { paths: nodePathPort, existing, mode: 'create' })
  // This module holds the db, so it can phrase its own refusals — which keeps
  // the wording these messages have always had.
  if (!v.ok) throw new Error(issuesToText(v.errors, loadSettings(db).uiLanguage))
  return upsertType(db, { ...normalized, isBuiltin: false })
}

// Update: custom types are fully editable; built-ins only their presentation
// (label/emoji/description/color) — family, behaviour and inputSchema are
// fixed (FR-017). A built-in that tries to change its family or behaviour is
// refused rather than silently ignored, so the user learns why.
export function updateTypeDef(db: DatabaseSync, def: TaskTypeDef): TaskTypeDef {
  const existing = getType(db, def.key)
  if (!existing) throw new Error(`type "${def.key}" not found`)
  const normalized = normalizeTypeDef(def, existing)
  const v = validateTypeDefinition(normalized, { paths: nodePathPort, existing, mode: 'update' })
  // This module holds the db, so it can phrase its own refusals — which keeps
  // the wording these messages have always had.
  if (!v.ok) throw new Error(issuesToText(v.errors, loadSettings(db).uiLanguage))
  const merged: TaskTypeDef = existing.isBuiltin
    ? {
        ...existing,
        label: normalized.label,
        emoji: normalized.emoji,
        description: normalized.description,
        color: normalized.color,
        // A built-in's IDENTITY is fixed — its family, its behaviour, its
        // declared inputs (FR-017). Its destination is not identity: pointing
        // the seeded Document type at a folder is the feature's own guided
        // flow (Q1/FR-007), and refusing it would make that scenario
        // unreachable.
        destination: normalized.destination
      }
    : normalized
  const saved = upsertType(db, merged)
  // A narrowed schema must not strand tasks: an input the type no longer
  // declares is rejected by validation on every write, so the task would be
  // uneditable and unfinishable until the value was cleared by hand. Removing
  // the stale key is the same reconciliation the migration performs.
  reconcileInputsForType(db, saved.key)
  return saved
}

/**
 * Fill in the fields a caller may legitimately omit. Feature 002 deleted the
 * legacy-workflow fallback (research D1/D2): every row in the registry
 * declares its behaviour outright (the column is NOT NULL since v5, and
 * validation refuses an undeclared one), so nothing is inferred from history.
 * An omitted `family` keeps the stored value — absence means "no assistance",
 * never a guess.
 */
function normalizeTypeDef(def: TaskTypeDef, existing: TaskTypeDef | null): TaskTypeDef {
  return { ...def, family: def.family === undefined ? (existing?.family ?? null) : def.family }
}

// Delete: built-ins are never deletable (spec). Tasks referencing the type
// fall back to plain without losing core fields; already-written artifacts
// are files on disk and are not touched (FR-014/FR-016). Returns the ids of
// the re-homed tasks (US3-AC4: nothing silently loses its workflow — the
// transport broadcasts each re-home and reports `rehomedTo: 'plain'`).
export function deleteTypeDef(db: DatabaseSync, key: string): string[] {
  const existing = getType(db, key)
  if (!existing) return []
  if (existing.isBuiltin) throw new Error('built-in types cannot be removed')
  const rehomed = reassignTasksFromType(db, key)
  deleteType(db, key)
  return rehomed
}
