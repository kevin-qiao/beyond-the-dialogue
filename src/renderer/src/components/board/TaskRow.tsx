import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { typeMeta, statusChip } from './status'

interface Props {
  task: Task
  jobStep: { stepLabel: string | null; state: string } | null
  selected?: boolean
  onSelect: () => void
}

// Board task row (docs/workboard-ux.html): emoji · title · type label + status
// dot-chip on the first line; quick actions (analyze/star/cancel) sit on the
// right and reveal on hover so the row stays scannable.
export function TaskRow({ task, jobStep, selected, onSelect }: Props) {
  const { toggleTask, setMyDay, requestReanalysis, cancelJob, notify } = useApp()
  const { snapshot, liveJobs } = useApp()
  const suggestions = snapshot?.suggestions.filter((s) => s.taskId === task.id && !s.dismissed) ?? []
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const meta = typeMeta(task.type)
  const chip = statusChip(task, jobStep)

  const analyzeAction = () => {
    if (!snapshot?.aiConfigured) {
      notify('AI not configured — open Settings to enable analysis')
      return
    }
    void requestReanalysis(task.id)
  }

  const showAnalyze = task.type === 'paper_reading' && !jobStep && (task.analysisStatus === 'none' || task.analysisStatus === 'failed')
  const showReanalyze =
    task.type === 'paper_reading' && !jobStep && (task.analysisStatus === 'ready' || task.analysisStatus === 'abstract_only')

  return (
    <div className={`task-row ${task.completed ? 'done' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className="t-emoji">{meta.emoji}</span>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className="type-tag">{meta.label}</span>
          {chip}
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
        {showAnalyze && (
          <button
            className="mini-btn row-act"
            onClick={(e) => {
              e.stopPropagation()
              analyzeAction()
            }}
            title={snapshot?.aiConfigured ? 'Start analysis' : 'AI not configured'}
          >
            Analyze
          </button>
        )}
        {showReanalyze && (
          <button
            className="mini-btn row-act"
            onClick={(e) => {
              e.stopPropagation()
              analyzeAction()
            }}
            title="Re-run analysis"
          >
            Re-run
          </button>
        )}
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
