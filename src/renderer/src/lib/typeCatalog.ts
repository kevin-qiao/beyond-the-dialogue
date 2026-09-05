import type { Task, TaskKind, TaskTypeDef } from '../../../shared/types'

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
  label: 'Plain task',
  emoji: '📝',
  inputSchema: [],
  isBuiltin: true
}

export function allTypeConfigs(types?: TaskTypeDef[] | null): TaskTypeDef[] {
  return types && types.length > 0 ? types : [FALLBACK_PLAIN]
}

export function getTypeConfig(key: string | null | undefined, types?: TaskTypeDef[] | null): TaskTypeDef {
  if (!key) return FALLBACK_PLAIN
  const found = allTypeConfigs(types).find((c) => c.key === key)
  if (found) return found
  return { key, kind: 'plain', label: key, emoji: '📌', inputSchema: [], isBuiltin: false }
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

export function typeLabel(task: Pick<Task, 'type' | 'customTypeKey'>, types?: TaskTypeDef[] | null): string {
  return effectiveType(task, types).label
}

export function typeEmoji(task: Pick<Task, 'type' | 'customTypeKey'>, types?: TaskTypeDef[] | null): string {
  return effectiveType(task, types).emoji
}

// Filter-chip key for grouping: customTypeKey if set, else the built-in.
export function typeFilterKey(task: Pick<Task, 'type' | 'customTypeKey'>): string {
  return task.customTypeKey ?? task.type
}
