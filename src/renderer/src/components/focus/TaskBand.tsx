import { useEffect, useState } from 'react'
import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useDialog } from '../ui/Dialog'
import { displayTypeLabel, effectiveType } from '../../lib/typeCatalog'
import { useLanguage, useLocale, useT } from '../../lib/useT'
import { statusChip } from '../board/status'
import { hasPreprocess } from '../../../../core/domain/preprocess'

// AI band of the focus column (spec app-layout, design D4): everything about
// the selected task except its working note — the header (title editing),
// pre-process status + outputs, the agent's suggestions, and one action line
// holding My Day, complete, delete and the alarm. Notes live in TaskNotes.
//
// Neither the type nor its declared inputs are changed here. The type is set
// at creation and re-chosen in the task's ✎ Edit modal (TaskForm), which owns
// the one type select and the one TaskInputsForm in the app.
export function TaskBand({ task }: { task: Task }) {
  const { snapshot, types, toggleTask, setMyDay, deleteTask, updateTask, finishTask, runPreprocess, setAlarm, notify, cancelJob, liveJobs } = useApp()
  const t = useT()
  const language = useLanguage()
  const locale = useLocale()
  const def = effectiveType(task, types)
  const preprocess = snapshot?.preprocess[task.id]
  const notes = snapshot?.notes[task.id]
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const chip = statusChip(t, task, types)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [alarmDraft, setAlarmDraft] = useState('')
  const [editingAlarm, setEditingAlarm] = useState(false)
  const { confirm, dialog } = useDialog()

  // Remount on task switch resets the drafts.
  useEffect(() => {
    setTitleDraft(task.title)
    setAlarmDraft(task.alarmAt ? task.alarmAt.slice(0, 16) : '')
    setEditingAlarm(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  // Whether this kind pre-processes is the registry's answer, not a comparison
  // against `plain` — the same declaration decides which kinds get a
  // suggestion job instead (taskService.setMyDay).
  const hasPre = hasPreprocess(def.kind)
  const running = task.preprocessStatus === 'queued' || task.preprocessStatus === 'running'
  // A kind that does not pre-process gets its chips from the suggestion job and
  // has no card to carry them, so they need a section of their own. Whether it
  // has any decides if that section is rendered at all: an empty "Suggestions"
  // heading is noise.
  const ownSuggestions = hasPre ? [] : (snapshot?.suggestions ?? []).filter((s) => s.taskId === task.id)

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

  const handleFinishClick = async () => {
    if (def.kind === 'learning') {
      const hasNote = (notes?.content ?? '').trim().length > 0
      if (!hasNote) {
        const ok = await confirm({
          title: t('task.finishEmpty.title'),
          message: t('task.finishEmpty.message'),
          confirmLabel: t('task.finishEmpty.confirm'),
          danger: true
        })
        if (!ok) return
      }
    }
    try {
      await finishTask(task.id)
    } catch (e: any) {
      notify(e?.message ?? t('task.finish.failed'))
    }
  }

  const runPre = () => {
    if (!snapshot?.aiConfigured) {
      notify(t('task.preprocess.aiNotConfigured'))
      return
    }
    void runPreprocess(task.id).catch((e: any) => notify(e?.message ?? t('task.preprocess.failed')))
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
                  void setAlarm(task.id, new Date(alarmDraft).toISOString()).then(() => notify(t('task.alarm.isSet')))
                  setEditingAlarm(false)
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

      {hasPre && (
        <section className="analysis-section">
          <div className="section-head">
            <h4>{t('task.preprocess.title')}</h4>
            <div className="row">
              {running ? (
                <>
                  <span className="badge running">{t('agent.working')}</span>
                  {activeJob && (
                    <button className="mini-btn cancel" onClick={() => void cancelJob(activeJob.jobId)}>
                      {t('common.cancel')}
                    </button>
                  )}
                </>
              ) : (
                <button className="mini-btn" onClick={runPre}>
                  {preprocess ? t('task.preprocess.rerun') : t('task.preprocess.runNow')}
                </button>
              )}
            </div>
          </div>

          {task.preprocessStatus === 'failed' && (
            <div className="warning-box">
              <p>{t('task.preprocess.failedWith', { error: task.preprocessError ?? t('task.preprocess.unknownError') })}</p>
              <button className="primary-btn" onClick={runPre}>
                {t('common.retry')}
              </button>
            </div>
          )}

          {running && (
            <div className="muted live-step">
              {activeJob?.stepLabel ?? (task.preprocessStatus === 'queued' ? t('task.preprocess.queued') : t('agent.working'))}
            </div>
          )}

          {!preprocess && !running && task.preprocessStatus !== 'failed' && (
            <div className="empty-hint">
              {snapshot?.aiConfigured
                ? t('task.preprocess.emptyHint', { kind: def.kind })
                : t('task.preprocess.emptyHintNoAi')}
            </div>
          )}

          {preprocess && (
            <div className="analysis-cards">
              {preprocess.summary && (
                <PreCard kind="summary" title={t('task.preprocess.summary')}>
                  <p>{preprocess.summary}</p>
                </PreCard>
              )}
              {preprocess.analysis && (
                <PreCard kind="analysis" title={t('task.preprocess.analysis')}>
                  <p>{preprocess.analysis}</p>
                </PreCard>
              )}
              {preprocess.suggestions.length > 0 && (
                <PreCard kind="suggest" title={t('task.preprocess.suggestions')}>
                  <SuggestionList task={task} recorded={preprocess.suggestions} />
                </PreCard>
              )}
            </div>
          )}
        </section>
      )}

      {/* A kind without a pre-process has no card to carry the suggestion job's
          chips, and the board row no longer repeats them — without this they
          would have no surface at all. */}
      {!hasPre && ownSuggestions.length > 0 && (
        <section className="analysis-section">
          <div className="section-head">
            <h4>{t('task.preprocess.suggestions')}</h4>
          </div>
          <SuggestionList task={task} />
        </section>
      )}

      {hasPre && def.kind !== 'learning' && !task.completed && (
        <div className="finish-row">
          <button className="finish-btn" onClick={() => void handleFinishClick()}>
            {t('task.finish')}
          </button>
        </div>
      )}
      {dialog}
    </div>
  )
}

/**
 * The agent's suggestions for a task, with the × to dismiss.
 *
 * Sourced from the suggestions table — the same rows `dismissSuggestion`
 * writes — so the list and the dismissal cannot disagree. `recorded` is the
 * pre-process's own copy, shown read-only when a task has no chips (an older
 * task, whose pre-process predates them); once chips exist they are the list,
 * and dismissing every one says so rather than resurrecting the record.
 */
function SuggestionList({ task, recorded = [] }: { task: Task; recorded?: string[] }) {
  const { snapshot } = useApp()
  const t = useT()
  const chips = (snapshot?.suggestions ?? []).filter((s) => s.taskId === task.id)
  const live = chips.filter((s) => !s.dismissed)

  if (live.length > 0) {
    return (
      <div className="suggestion-chips">
        {live.map((s) => (
          <span key={s.id} className="chip">
            {s.text}
            <button
              className="chip-x"
              title={t('task.suggestions.dismiss')}
              onClick={() => void window.api.dismissSuggestion({ suggestionId: s.id })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    )
  }
  if (chips.length > 0) return <p className="muted">{t('task.suggestions.allDismissed')}</p>
  if (recorded.length === 0) return null
  return (
    <ul>
      {recorded.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  )
}

// Pre-process output card with iconified header + accent rail (reuses the v2
// analysis-card visuals).
function PreCard({ kind, title, children }: { kind: 'summary' | 'analysis' | 'suggest'; title: string; children: React.ReactNode }) {
  const cls = kind === 'summary' ? 'accent-blue' : kind === 'suggest' ? 'accent-ok' : ''
  const glyph = kind === 'summary' ? 'S' : kind === 'analysis' ? 'A' : '✦'
  return (
    <div className={`analysis-card ${cls}`}>
      <div className="card-head">
        <span className={`card-icon ${kind}`}>{glyph}</span>
        <span className="card-title">{title}</span>
      </div>
      {children}
    </div>
  )
}
