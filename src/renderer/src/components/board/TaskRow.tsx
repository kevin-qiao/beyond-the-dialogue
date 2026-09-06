import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { statusChip } from './status'
import { effectiveType } from '../../lib/typeCatalog'

interface Props {
  task: Task
  jobStep: { stepLabel: string | null; state: string } | null
  selected?: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent, task: Task) => void
}

// Board task row: emoji · title · type label + status dot-chip on the first
// line; quick actions (star/complete/cancel) on the right, revealed on hover
// so the row stays scannable. Pre-processing is triggered from My Day / the
// focus band — the row never runs jobs itself.
export function TaskRow({ task, jobStep, selected, onSelect, onContextMenu }: Props) {
  const { snapshot, types, toggleTask, setMyDay, cancelJob, liveJobs } = useApp()
  const suggestions = snapshot?.suggestions.filter((s) => s.taskId === task.id && !s.dismissed) ?? []
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const def = effectiveType(task, types)
  const chip = statusChip(task, types, jobStep)

  return (
    <div className={`task-row ${task.completed ? 'done' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect} onContextMenu={(e) => onContextMenu(e, task)}>
      <span className="t-emoji">{def.emoji}</span>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className="type-tag">{def.label}</span>
          {chip}
          {task.alarmAt && <span className="badge" title={`Alarm ${new Date(task.alarmAt).toLocaleString()}`}>⏰</span>}
          {task.inMyDay && !task.completed && suggestions.length === 0 && !jobStep && (
            <span className="muted suggest-hint">suggestions pending</span>
          )}
        </div>
        {jobStep && <div className="task-step">{jobStep.stepLabel ?? 'working…'}</div>}
        {suggestions.length > 0 && (
          <div className="suggestion-chips">
            {suggestions.map((s) => (
              <span key={s.id} className="chip subtle-chip">
                {s.text}
                <button
                  className="chip-x"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.api.dismissSuggestion({ suggestionId: s.id })
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="task-actions">
        {activeJob && (
          <button
            className="mini-btn row-act cancel"
            onClick={(e) => {
              e.stopPropagation()
              void cancelJob(activeJob.jobId)
            }}
            title="Stop the running job"
          >
            Cancel
          </button>
        )}
        <button
          className={`day-toggle ${task.inMyDay ? 'in' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            void setMyDay(task.id, !task.inMyDay)
          }}
          title={task.inMyDay ? 'Remove from My Day' : 'Add to My Day'}
        >
          {task.inMyDay ? '★' : '☆'}
        </button>
        <button
          className={`check ${task.completed ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            void toggleTask(task.id)
          }}
          title={task.completed ? 'Mark incomplete' : 'Mark complete'}
        />
      </div>
    </div>
  )
}
