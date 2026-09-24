import type { Task, TaskKind, TaskTypeDef, TypeInputField } from '../../../shared/types'
import { en, isMessageKey, message, type Language, type MessageKey } from '../../../core/i18n'

// Centralized type catalog (design D2): tasks carry a built-in `type` and an
// optional `customTypeKey` resolved against the task_types registry (delivered
// in AppSnapshot.taskTypes). This module resolves the effective type + kind
// for display, filtering, and creation — components should never hardcode
// type labels/emoji/kinds. Fallbacks keep the UI alive if a custom key
// disappears (the task then reads as plain, mirroring the main-side
// reassignment on type deletion).

const FALLBACK_PLAIN: TaskTypeDef = {
  key: 'plain',
  kind: 'plain',
  // From the catalog, not a second copy of the string: this is what renders
  // before the first snapshot lands, and a hardcoded English label would flash
  // English in a Chinese interface on every start.
  label: en['type.plain.label'],
  emoji: '📝',
  inputSchema: [],
  isBuiltin: true,
  // A plain task finishes locally and writes nothing.
  finishBehaviour: 'complete-only',
  grants: { skills: [], toolServers: [] }
}

export function allTypeConfigs(types?: TaskTypeDef[] | null): TaskTypeDef[] {
  return types && types.length > 0 ? types : [FALLBACK_PLAIN]
}

export function getTypeConfig(key: string | null | undefined, types?: TaskTypeDef[] | null): TaskTypeDef {
  if (!key) return FALLBACK_PLAIN
  const found = allTypeConfigs(types).find((c) => c.key === key)
  if (found) return found
  return { key, kind: 'plain', label: key, emoji: '📌', inputSchema: [], isBuiltin: false, finishBehaviour: 'complete-only', grants: { skills: [], toolServers: [] } }
}

// Effective type for a task: customTypeKey wins when the referenced type
// still exists; otherwise the built-in type. Always returns a def.
export function effectiveType(task: Pick<Task, 'type' | 'customTypeKey'>, types?: TaskTypeDef[] | null): TaskTypeDef {
  if (task.customTypeKey) {
    const match = allTypeConfigs(types).find((c) => c.key === task.customTypeKey)
    if (match) return match
  }
  return getTypeConfig(task.type, types)
}

// Behavior kind for dispatch (working area, AI band, pre-process display).
export function effectiveKind(task: Pick<Task, 'type' | 'customTypeKey'>, types?: TaskTypeDef[] | null): TaskKind {
  return effectiveType(task, types).kind
}

export function typeEmoji(task: Pick<Task, 'type' | 'customTypeKey'>, types?: TaskTypeDef[] | null): string {
  return effectiveType(task, types).emoji
}

// ---- showing a seeded type in the active language ----
//
// The built-ins' labels, descriptions and field labels are seeded ROWS, and the
// Types tab lets the user rename them. So a stored value is shown translated
// only while it is still exactly what was seeded: the moment it differs, it is
// the user's words and is shown as written. That needs no migration and cannot
// clobber a rename — the comparison is done at render time, and nothing is
// written back.
//
// The keys are derived, so a type that has no catalog entry (every custom one)
// simply does not translate.

function builtinKey(typeKey: string, part: 'label' | 'description'): MessageKey | null {
  const key = `type.${typeKey}.${part}`
  return isMessageKey(key) ? key : null
}

/** The stored value in the active language, or as written when the user owns it. */
function display(stored: string | undefined, key: MessageKey | null, language: Language): string | undefined {
  if (stored === undefined) return undefined
  if (!key) return stored
  return stored === en[key] ? message(language, key) : stored
}

export function displayTypeLabel(def: TaskTypeDef, language: Language): string {
  return display(def.label, builtinKey(def.key, 'label'), language) ?? def.label
}

export function displayTypeDescription(def: TaskTypeDef, language: Language): string | undefined {
  return display(def.description, builtinKey(def.key, 'description'), language)
}

export function displayFieldLabel(def: TaskTypeDef, field: TypeInputField, language: Language): string {
  const key = builtinKey(def.key, 'label')
  // A field's label translates when its type does and the field itself is
  // unchanged; a field the user added to a custom type has no key at all.
  const fieldKey = key ? (`type.${def.key}.field.${field.key}.label` as const) : null
  const usable = fieldKey && isMessageKey(fieldKey) ? fieldKey : null
  return display(field.label, usable, language) ?? field.label
}

export function displayFieldPlaceholder(def: TaskTypeDef, field: TypeInputField, language: Language): string | undefined {
  const fieldKey = `type.${def.key}.field.${field.key}.placeholder`
  const usable = isMessageKey(fieldKey) ? fieldKey : null
  return display(field.placeholder, usable, language)
}

/** A copy of the type with every seeded string shown in the active language. */
export function localizeTypeDef(def: TaskTypeDef, language: Language): TaskTypeDef {
  return {
    ...def,
    label: displayTypeLabel(def, language),
    description: displayTypeDescription(def, language),
    inputSchema: def.inputSchema.map((field) => ({
      ...field,
      label: displayFieldLabel(def, field, language),
      placeholder: displayFieldPlaceholder(def, field, language),
      options: field.options?.map((option) => {
        const optionKey = `type.${def.key}.field.${field.key}.option.${option.value}`
        return { ...option, label: display(option.label, isMessageKey(optionKey) ? optionKey : null, language) ?? option.label }
      })
    }))
  }
}

/** The label on a type's chip or row, in the active language. */
export function typeLabel(
  task: Pick<Task, 'type' | 'customTypeKey'>,
  types: TaskTypeDef[] | null | undefined,
  language: Language
): string {
  return displayTypeLabel(effectiveType(task, types), language)
}

// Filter-chip key for grouping: customTypeKey if set, else the built-in.
export function typeFilterKey(task: Pick<Task, 'type' | 'customTypeKey'>): string {
  return task.customTypeKey ?? task.type
}
