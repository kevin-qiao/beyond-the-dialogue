import type { Task, TaskTypeDef } from '../../../../shared/types'
import { effectiveKind, effectiveType } from '../../lib/typeCatalog'

// Shared v2 visuals (docs/workboard-ux.html): per-type emoji/label and the
// status dot-chip. Rows, the focus head, and band share these so the board
// reads consistently.

export function typeMeta(type: string, types?: TaskTypeDef[] | null): { emoji: string; label: string } {
  // typeMeta resolves a raw key; prefer effectiveType(task, types) when you
  // have a Task so custom types resolve correctly.
  const def = effectiveType({ type: type as Task['type'], customTypeKey: null }, types)
  return { emoji: def.emoji, label: def.label }
}

export type DotState = 'running' | 'ready' | 'failed' | 'queued' | 'none'

export interface JobStepLike {
  stepLabel?: string | null
  state?: string
}

export function dotStateOf(task: Task, types?: TaskTypeDef[] | null, jobStep?: JobStepLike | null): DotState {
  if (jobStep) return 'running'
  // Only AI-kinded tasks (learning/jira via their type's kind) have a
  // pre-process pipeline; plain tasks never show a chip.
  if (effectiveKind(task, types) === 'plain') return 'none'
  if (task.preprocessStatus === 'queued' || task.preprocessStatus === 'running') return 'running'
  if (task.preprocessStatus === 'ready') return 'ready'
  if (task.preprocessStatus === 'failed') return 'failed'
  if (task.inMyDay && !task.completed) return 'queued'
  return 'none'
}

const LABEL: Record<DotState, string> = {
  running: 'working',
  ready: 'ready',
  failed: 'failed',
  queued: 'queued',
  none: ''
}

export function statusChip(task: Task, types?: TaskTypeDef[] | null, jobStep?: JobStepLike | null) {
  const state = dotStateOf(task, types, jobStep)
  if (state === 'none') return null
  return (
    <span className={`st-chip ${state}`}>
      <span className="dot" />
      {LABEL[state]}
    </span>
  )
}
