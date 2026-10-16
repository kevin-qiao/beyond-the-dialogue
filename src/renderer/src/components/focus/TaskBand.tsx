import { useEffect, useState } from 'react'
import type { FinishMode, Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useDialog } from '../ui/Dialog'
import { displayTypeLabel, effectiveType } from '../../lib/typeCatalog'
import { useLanguage, useLocale, useT } from '../../lib/useT'
import { statusChip } from '../board/status'
import { defaultFinishMode } from '../../../../core/services/finishService'
import { isAssistantEnabled } from '../../../../core/domain/assistant'
import { isConfigured } from '../../../../core/domain/config'

// Band of the focus column (spec app-layout): everything about the selected
// task except its working note — the header (title editing) and one action
// line holding My Day, complete, delete and the alarm. Notes live in
// TaskNotes.
//
// Feature 002 deleted the POC's AI surfaces here (D4): the pre-process card,
// its status chip and the suggestion chips are gone with the engines. The
// finish choice (organize & file / file as written) lands in T022.
//
// Neither the type nor its declared inputs are changed here. The type is set
// at creation and re-chosen in the task's ✎ Edit modal (TaskForm), which owns
// the one type select and the one TaskInputsForm in the app.
export function TaskBand({ task }: { task: Task }) {
  const { snapshot, types, toggleTask, setMyDay, deleteTask, updateTask, finishTask, setAlarm, notify } = useApp()
  const t = useT()
  const language = useLanguage()
  const locale = useLocale()
  const def = effectiveType(task, types)
  const chip = statusChip(t, task, types)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [alarmDraft, setAlarmDraft] = useState('')
  const [editingAlarm, setEditingAlarm] = useState(false)
  const { confirm, dialog } = useDialog()

  // The finish choice (D8): it appears ONLY where an assistant step would run
  // — an organize-capable Type with the assistant available. The default
  // selection comes from the declaration. While the switch is off or AI is
  // unconfigured no choice renders: finishing files as written and the report
  // names the skipped step (US1-AC4).
  const assistantAvailable =
    !!snapshot && isAssistantEnabled(snapshot.settings) && isConfigured(snapshot.settings)
  const offersChoice = def.finishBehaviour === 'polish-then-file' && assistantAvailable
  const [finishMode, setFinishMode] = useState<FinishMode>(defaultFinishMode(def))

  // Remount on task switch resets the drafts.
  useEffect(() => {
    setTitleDraft(task.title)
    setAlarmDraft(task.alarmAt ? task.alarmAt.slice(0, 16) : '')
    setEditingAlarm(false)
    setFinishMode(defaultFinishMode(def))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  const handleDeleteClick = async () => {
    const ok = await confirm({
      title: t('task.delete.title'),
      message: t('task.delete.message', { title: task.title }),
      confirmLabel: t('common.delete'),
      danger: true
    })
    if (ok) void deleteTask(task.id)
  }

  const saveTitle = () => {
    setEditingTitle(false)
    if (titleDraft !== task.title && titleDraft.trim()) void updateTask({ id: task.id, title: titleDraft.trim() })
  }

  const handleFinishClick = async (mode?: FinishMode) => {
    try {
      // The result is the contract report; the task update and the
      // where-it-went toast arrive through their own events.
      await finishTask(task.id, mode)
    } catch (e: any) {
      // A refusal arrives already localized from handleCommand; the task stays
      // open and actionable (FR-007, US1-AC6).
      notify(e?.message ?? t('task.finish.failed'))
    }
  }

  return (
    <div className="detail">
      <div className="detail-head">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h3>
            <span className="f-emoji">{def.emoji}</span>
            <span className="f-title">{task.title}</span>
            <button className="title-edit-btn" title={t('task.title.edit')} onClick={() => setEditingTitle(true)}>
              ✎
            </button>
          </h3>
        )}
        <div className="f-meta">
          <span className="type-tag">{displayTypeLabel(def, language)}</span>
          <code className="type-key">{def.key}</code>
          {chip}
          {task.alarmAt && (
            <span className="badge" title={t('task.alarm.isSet')}>
              ⏰ {new Date(task.alarmAt).toLocaleString(locale)}
            </span>
          )}
        </div>
        <div className="detail-actions">
          <button className={`day-toggle ${task.inMyDay ? 'in' : ''}`} onClick={() => void setMyDay(task.id, !task.inMyDay)}>
            {task.inMyDay ? `★ ${t('task.myDay.in')}` : `☆ ${t('task.myDay.add')}`}
          </button>
          <button className="secondary-btn" onClick={() => void toggleTask(task.id)}>
            {task.completed ? t('task.reopen') : t('task.complete')}
          </button>
          <button className="danger-btn" onClick={() => void handleDeleteClick()}>
            {t('common.delete')}
          </button>
          {/* The alarm is an action like the rest, so it sits on their line
              rather than claiming a section of its own. The control only
              appears while it is being edited; the set time shows in .f-meta. */}
          <button
            className={`secondary-btn alarm-toggle ${task.alarmAt ? 'on' : ''}`}
            onClick={() => setEditingAlarm((v) => !v)}
            title={
              task.alarmAt
                ? t('task.alarm.setFor', { when: new Date(task.alarmAt).toLocaleString(locale) })
                : t('task.alarm.setHint')
            }
          >
            ⏰ {task.alarmAt ? t('task.alarm.isSet') : t('task.alarm.label')}
          </button>
          {editingAlarm && (
            <span className="alarm-inline">
              <input
                type="datetime-local"
                value={alarmDraft}
                aria-label={t('task.alarm.time')}
                onChange={(e) => setAlarmDraft(e.target.value)}
              />
              <button
                className="mini-btn"
                disabled={!alarmDraft}
                onClick={() => {
                  // FR-007: a past time comes back as the localized refusal
                  // the core raised — show it, keep the draft open, and leave
                  // any existing alarm exactly as it was.
                  void setAlarm(task.id, new Date(alarmDraft).toISOString())
                    .then(() => {
                      notify(t('task.alarm.isSet'))
                      setEditingAlarm(false)
                    })
                    .catch((e: any) => notify(e?.message ?? t('task.alarm.pastTime')))
                }}
              >
                {t('common.set')}
              </button>
              {task.alarmAt && (
                <button
                  className="mini-btn"
                  onClick={() => {
                    void setAlarm(task.id, null)
                    setEditingAlarm(false)
                  }}
                >
                  {t('common.clear')}
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {task.completed && (
        <div className="completed-banner">
          {t('task.completedBanner', { when: task.completedAt ? new Date(task.completedAt).toLocaleString(locale) : '' })}
        </div>
      )}

      {!task.completed && def.finishBehaviour !== 'complete-only' && (
        <div className="finish-row">
          {offersChoice ? (
            <>
              {/* The two-mode choice (FR-003): the declaration's default is
                  pre-selected; each button finishes with its mode. */}
              <select
                className="finish-mode"
                value={finishMode}
                aria-label={t('task.finish.modeLabel')}
                onChange={(e) => setFinishMode(e.target.value as FinishMode)}
              >
                <option value="assisted">{t('task.finish.organize')}</option>
                <option value="as-written">{t('task.finish.asWritten')}</option>
              </select>
              <button className="finish-btn" onClick={() => void handleFinishClick(finishMode)}>
                {finishMode === 'assisted' ? t('task.finish.organize') : t('task.finish.asWritten')}
              </button>
            </>
          ) : (
            <button className="finish-btn" onClick={() => void handleFinishClick()}>
              {t('task.finish')}
            </button>
          )}
        </div>
      )}
      {dialog}
    </div>
  )
}
