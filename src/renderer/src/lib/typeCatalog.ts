import type { Settings, Task, TaskTypeConfig } from '../../../shared/types'

// Centralized type catalog. Tasks carry a `type` ('plain' | 'paper_reading')
// AND an optional `customTypeKey` pointing into settings.customTypes. This
// module resolves the effective type for display, filtering, and creation —
// components should never hardcode type labels/emoji/icons.

export const BUILTIN_TYPE_CONFIGS: TaskTypeConfig[] = [
  {
    key: 'plain',
    label: 'Plain task',
    emoji: '📝',
    description: '通用任务 — 无链接 / 无自动分析',
    isCustom: false
  },
  {
    key: 'paper_reading',
    label: 'Paper reading',
    emoji: '📄',
    description: '论文阅读 — 粘贴链接自动触发 AI 分析',
    isCustom: false
  }
]

// All known configs: built-ins first, then user-defined (sorted by key).
export function allTypeConfigs(settings?: Pick<Settings, 'customTypes'> | null): TaskTypeConfig[] {
  const customs = settings?.customTypes ?? []
  return [...BUILTIN_TYPE_CONFIGS, ...customs]
}

// Look up a single config by key. Falls back to the built-in if the key is
// a built-in even when no settings are passed; falls back to a synthetic
// "unknown" record for missing custom keys so the UI never crashes.
export function getTypeConfig(key: string | null | undefined, settings?: Pick<Settings, 'customTypes'> | null): TaskTypeConfig {
  if (!key) return BUILTIN_TYPE_CONFIGS[0]!
  const found = allTypeConfigs(settings).find((c) => c.key === key)
  if (found) return found
  // Unknown key — synthesize a placeholder so the UI still renders something.
  return { key, label: key, emoji: '📌', description: undefined, isCustom: true }
}

// Resolve a task's effective type: customTypeKey wins when the referenced
// config still exists; otherwise the built-in type. Always returns a config.
export function effectiveType(task: Pick<Task, 'type' | 'customTypeKey'>, settings?: Pick<Settings, 'customTypes'> | null): TaskTypeConfig {
  if (task.customTypeKey) {
    const customs = settings?.customTypes ?? []
    const match = customs.find((c) => c.key === task.customTypeKey)
    if (match) return match
  }
  return getTypeConfig(task.type, settings)
}

// Convenience accessors used by most call sites.
export function typeLabel(task: Pick<Task, 'type' | 'customTypeKey'>, settings?: Pick<Settings, 'customTypes'> | null): string {
  return effectiveType(task, settings).label
}

export function typeEmoji(task: Pick<Task, 'type' | 'customTypeKey'>, settings?: Pick<Settings, 'customTypes'> | null): string {
  return effectiveType(task, settings).emoji
}

// Filter-chip key for grouping: customTypeKey if set, else the built-in.
export function typeFilterKey(task: Pick<Task, 'type' | 'customTypeKey'>): string {
  return task.customTypeKey ?? task.type
}
