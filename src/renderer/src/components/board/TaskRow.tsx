import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useLanguage, useLocale, useT } from '../../lib/useT'
import { statusChip } from './status'
import { displayTypeLabel, effectiveType } from '../../lib/typeCatalog'

interface Props {
  task: Task
  jobStep: { stepLabel: string | null; state: string } | null
  selected?: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent, task: Task) => void
}

// Board task row: title, then type label + status dot-chip, and the quick
// actions (star/complete/cancel) on the right, revealed on hover so the row
// stays scannable.
//
// The row stays this thin on purpose — it is the scanning surface. The agent's
// suggestions are not repeated here; they live in the focus band, where they
// can be read and dismissed without turning every row into a card. A running
// job still shows through the status chip, and the Cancel action stays with
// the other row actions.
export function TaskRow({ task, jobStep, selected, onSelect, onContextMenu }: Props) {
  const { types, toggleTask, setMyDay, cancelJob, liveJobs } = useApp()
  const t = useT()
  const language = useLanguage()
  const locale = useLocale()
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const def = effectiveType(task, types)
  const chip = statusChip(t, task, types, jobStep)

  return (
    <div className={`task-row ${task.completed ? 'done' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect} onContextMenu={(e) => onContextMenu(e, task)}>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className="type-tag">{displayTypeLabel(def, language)}</span>
          {chip}
          {task.alarmAt && (
            <span className="badge" title={t('task.alarm.title', { when: new Date(task.alarmAt).toLocaleString(locale) })}>
              ⏰
            </span>
          )}
        </div>
      </div>
      <div className="task-actions">
        {activeJob && (
          <button
            className="mini-btn row-act cancel"
            onClick={(e) => {
              e.stopPropagation()
              void cancelJob(activeJob.jobId)
            }}
            title={t('task.cancelJob')}
          >
            {t('common.cancel')}
          </button>
        )}
        <button
          className={`day-toggle ${task.inMyDay ? 'in' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            void setMyDay(task.id, !task.inMyDay)
          }}
          title={task.inMyDay ? t('task.myDay.remove') : t('task.myDay.add')}
        >
          {task.inMyDay ? '★' : '☆'}
        </button>
        <button
          className={`check ${task.completed ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            void toggleTask(task.id)
          }}
          title={task.completed ? t('task.toggle.incomplete') : t('task.toggle.complete')}
        />
      </div>
    </div>
  )
}
