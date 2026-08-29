import type { Task } from '../../../shared/types'
import { useApp } from '../store'

interface Props {
  task: Task
  jobStep: { stepLabel: string | null; state: string } | null
  onSelect: () => void
}

export function TaskRow({ task, jobStep, onSelect }: Props) {
  const { toggleTask, setMyDay, selectTask } = useApp()
  const { snapshot } = useApp()
  const analysis = snapshot?.analyses[task.id]
  const suggestions = snapshot?.suggestions.filter((s) => s.taskId === task.id && !s.dismissed) ?? []

  const statusBadge = () => {
    if (jobStep) return <span className="badge running">{jobStep.stepLabel ?? 'working…'}</span>
    if (task.type === 'paper_reading') {
      if (task.analysisStatus === 'ready') return <span className="badge ok">analyzed</span>
      if (task.analysisStatus === 'abstract_only') return <span className="badge warn">abstract-only</span>
      if (task.analysisStatus === 'failed') return <span className="badge err">analysis failed</span>
      if (task.analysisStatus === 'queued' || task.analysisStatus === 'running') return <span className="badge running">analyzing…</span>
    }
    return null
  }

  return (
    <div className={`task-row ${task.completed ? 'done' : ''}`} onClick={onSelect}>
      <button
        className={`check ${task.completed ? 'checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          void toggleTask(task.id)
        }}
        title={task.completed ? 'Mark incomplete' : 'Mark complete'}
      />
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {suggestions.length > 0 && (
          <div className="suggestion-chips">
            {suggestions.map((s) => (
              <span key={s.id} className="chip">
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
        {analysis && <div className="task-tldr">{analysis.tldr}</div>}
      </div>
      <div className="task-meta">
        {statusBadge()}
        {task.type === 'paper_reading' && <span className="badge type">paper</span>}
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
        {task.inMyDay && !task.completed && suggestions.length === 0 && !jobStep && (
          <span className="badge subtle">suggestions pending…</span>
        )}
      </div>
    </div>
  )
}
