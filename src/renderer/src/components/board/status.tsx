import type { Task, TaskTypeDef } from '../../../../shared/types'
import type { MessageKey, Translate } from '../../../../core/i18n'
import { effectiveType } from '../../lib/typeCatalog'

// Shared v2 visuals (docs/workboard-ux.html): per-type emoji/label and the
// status dot-chip. Rows, the focus head, and band share these so the board
// reads consistently.

export function typeMeta(type: string, types?: TaskTypeDef[] | null): { emoji: string; label: string } {
  // typeMeta resolves a raw key; prefer effectiveType(task, types) when you
  // have a Task so custom types resolve correctly.
  const def = effectiveType({ type: type as Task['type'], customTypeKey: null }, types)
  return { emoji: def.emoji, label: def.label }
}

export type DotState = 'running' | 'none'

export interface JobStepLike {
  stepLabel?: string | null
  state?: string
}

// Feature 002 deleted the pre-process pipeline the dot used to mirror (D4):
// no board interaction starts background AI work, so the only live state is a
// job the user themselves started (a finish's organize step, a curation run).
export function dotStateOf(task: Task, types?: TaskTypeDef[] | null, jobStep?: JobStepLike | null): DotState {
  void task
  void types
  if (jobStep) return 'running'
  return 'none'
}

const LABEL: Record<DotState, MessageKey | null> = {
  running: 'task.status.working',
  none: null
}

// `t` is passed rather than read: this is a plain function, not a component,
// so it has no hook of its own to call.
export function statusChip(t: Translate, task: Task, types?: TaskTypeDef[] | null, jobStep?: JobStepLike | null) {
  const state = dotStateOf(task, types, jobStep)
  const key = LABEL[state]
  if (!key) return null
  return (
    <span className={`st-chip ${state}`}>
      <span className="dot" />
      {t(key)}
    </span>
  )
}
