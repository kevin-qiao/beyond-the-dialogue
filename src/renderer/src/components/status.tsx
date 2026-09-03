import type { Task } from '../../../shared/types'

// Shared v2 visuals (docs/workboard-ux.html): per-type emoji/label and the
// status dot-chip. Rows, the focus head, and band share these so the board
// reads consistently.

const TYPE_META: Record<string, { emoji: string; label: string }> = {
  plain: { emoji: '📝', label: 'Plain task' },
  paper_reading: { emoji: '📄', label: 'Paper reading' }
}

export function typeMeta(type: string): { emoji: string; label: string } {
  return TYPE_META[type] ?? { emoji: '📌', label: type.replace(/_/g, ' ') }
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
  // A My Day task of an agentic type whose first job hasn't fired reads as
  // queued. Plain tasks have no AI pipeline, so they never show a chip.
  if (task.type !== 'plain' && task.inMyDay && !task.completed) return 'queued'
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
