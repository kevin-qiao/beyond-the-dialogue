import type { Task } from '../../../../shared/types'
import { typeEmoji, typeLabel } from '../../lib/typeCatalog'

// Shared v2 visuals (docs/workboard-ux.html): per-type emoji/label and the
// status dot-chip. Rows, the focus head, and band share these so the board
// reads consistently.

export function typeMeta(type: string): { emoji: string; label: string } {
  // typeMeta is the legacy helper; prefer typeLabel/typeEmoji directly when
  // you have a Task (so custom types resolve correctly).
  return {
    emoji: typeEmoji({ type: type as Task['type'], customTypeKey: null }),
    label: typeLabel({ type: type as Task['type'], customTypeKey: null })
  }
}

export type DotState = 'running' | 'ready' | 'failed' | 'queued' | 'none'

export interface JobStepLike {
  stepLabel?: string | null
  state?: string
}

export function dotStateOf(task: Task, jobStep?: JobStepLike | null): DotState {
  if (jobStep) return 'running'
  if (task.type === 'paper_reading') {
    if (task.analysisStatus === 'queued' || task.analysisStatus === 'running') return 'running'
    if (task.analysisStatus === 'ready' || task.analysisStatus === 'abstract_only') return 'ready'
    if (task.analysisStatus === 'failed') return 'failed'
  }
  // Custom types and non-plain built-in types are agentic pipelines. Until
  // their first job fires, they read as 'queued' when added to My Day. Plain
  // tasks have no AI pipeline and never show a chip.
  const isAgentic = task.customTypeKey !== null || task.type !== 'plain'
  if (isAgentic && task.inMyDay && !task.completed) return 'queued'
  return 'none'
}

const LABEL: Record<DotState, string> = {
  running: 'working',
  ready: 'ready',
  failed: 'failed',
  queued: 'queued',
  none: ''
}

export function statusChip(task: Task, jobStep?: JobStepLike | null) {
  const state = dotStateOf(task, jobStep)
  if (state === 'none') return null
  return (
    <span className={`st-chip ${state}`}>
      <span className="dot" />
      {LABEL[state]}
    </span>
  )
}
