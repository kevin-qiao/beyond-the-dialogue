import { useEffect, useState } from 'react'
import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useDialog } from '../ui/Dialog'
import { effectiveType } from '../../lib/typeCatalog'
import { statusChip } from '../board/status'
import { TaskInputsForm } from '../board/TaskInputsForm'

// AI band of the focus column (spec app-layout, design D4): everything about
// the selected task except its working note — header/title/type editing,
// per-type inputs, alarm, pre-process status + outputs, and the actions
// (My Day, complete, Finish, delete). Notes live in TaskNotes.
export function TaskBand({ task }: { task: Task }) {
  const { snapshot, types, toggleTask, setMyDay, deleteTask, updateTask, finishTask, runPreprocess, setAlarm, notify, cancelJob, liveJobs } = useApp()
  const def = effectiveType(task, types)
  const preprocess = snapshot?.preprocess[task.id]
  const notes = snapshot?.notes[task.id]
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const chip = statusChip(task, types)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [inputsDraft, setInputsDraft] = useState<Record<string, unknown>>(task.inputs)
  const [alarmDraft, setAlarmDraft] = useState('')
  const { confirm, dialog } = useDialog()

  // Remount on task switch resets the drafts.
  useEffect(() => {
    setTitleDraft(task.title)
    setInputsDraft(task.inputs)
    setAlarmDraft(task.alarmAt ? task.alarmAt.slice(0, 16) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  const isAgentic = def.kind !== 'plain'
  const running = task.preprocessStatus === 'queued' || task.preprocessStatus === 'running'

  // Type change supports built-ins and custom type keys. Selecting a custom
  // key sets customTypeKey + that key's built-in behavior stays via the def;
  // built-in selections clear customTypeKey. Inputs are discarded on switch
  // (main clears them; spec task-types).
  const handleTypeChange = async (newKey: string) => {
    if (newKey === def.key) return
    const target = types.find((t) => t.key === newKey)
    if (!target) return
    if (target.kind !== 'plain' || def.kind !== 'plain') {
      const ok = await confirm({
        title: 'Change task type?',
        message: 'The type-specific inputs will be cleared for this task. Title, description, list, notes, and completion are kept.',
        confirmLabel: 'Change type',
        danger: true
      })
      if (!ok) return
    }
    const patch: { id: string; type?: Task['type']; customTypeKey?: string | null } = {
      id: task.id,
      type: target.isBuiltin ? (target.key as Task['type']) : 'plain',
      customTypeKey: target.isBuiltin ? null : target.key
    }
    void updateTask(patch)
  }

  const handleDeleteClick = async () => {
    const ok = await confirm({
      title: 'Delete task',
      message: `Delete "${task.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) void deleteTask(task.id)
  }

  const saveInputs = () => {
    void updateTask({ id: task.id, inputs: inputsDraft })
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
          title: 'Finish without notes?',
          message: 'Your learning note is empty. Nothing meaningful will be ingested to your wiki if you finish now.',
          confirmLabel: 'Finish anyway',
          danger: true
        })
        if (!ok) return
      }
    }
    try {
      await finishTask(task.id)
    } catch (e: any) {
      notify(e?.message ?? 'Finish failed')
    }
  }

  const runPre = () => {
    if (!snapshot?.aiConfigured) {
      notify('AI not configured — open Settings to enable pre-processing')
      return
    }
    void runPreprocess(task.id).catch((e: any) => notify(e?.message ?? 'Pre-process failed'))
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
            <button className="title-edit-btn" title="Edit title" onClick={() => setEditingTitle(true)}>
              ✎
            </button>
          </h3>
        )}
        <div className="f-meta">
          <span className="type-tag">{def.label}</span>
          <code className="type-key">{def.key}</code>
          {chip}
          {task.alarmAt && <span className="badge" title="Alarm set">⏰ {new Date(task.alarmAt).toLocaleString()}</span>}
        </div>
        <div className="detail-actions">
          <select
            className="type-select"
            value={def.key}
            onChange={(e) => void handleTypeChange(e.target.value)}
            title="Task type"
          >
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.emoji} {t.label}{t.isBuiltin ? '' : '（custom）'}
              </option>
            ))}
          </select>
          <button className={`day-toggle ${task.inMyDay ? 'in' : ''}`} onClick={() => void setMyDay(task.id, !task.inMyDay)}>
            {task.inMyDay ? '★ In My Day' : '☆ Add to My Day'}
          </button>
          <button className="secondary-btn" onClick={() => void toggleTask(task.id)}>
            {task.completed ? 'Reopen' : 'Complete'}
          </button>
          <button className="danger-btn" onClick={() => void handleDeleteClick()}>
            Delete
          </button>
        </div>
      </div>

      {task.completed && <div className="completed-banner">Completed {task.completedAt ? new Date(task.completedAt).toLocaleString() : ''}</div>}

      {def.inputSchema.length > 0 && (
        <section className="settings-section inputs-section">
          <div className="section-head">
            <h4>Details</h4>
            <button className="mini-btn" onClick={saveInputs}>
              Save
            </button>
          </div>
          <TaskInputsForm
            def={def}
            values={inputsDraft}
            onChange={setInputsDraft}
            settings={snapshot?.settings}
            lockedKeys={def.inputSchema.filter((f) => f.immutable).map((f) => f.key)}
          />
        </section>
      )}

      <section className="settings-section alarm-section">
        <div className="section-head">
          <h4>Alarm</h4>
          <div className="row">
            <input type="datetime-local" value={alarmDraft} onChange={(e) => setAlarmDraft(e.target.value)} />
            <button
              className="mini-btn"
              disabled={!alarmDraft}
              onClick={() => void setAlarm(task.id, new Date(alarmDraft).toISOString()).then(() => notify('Alarm set'))}
            >
              Set
            </button>
            {task.alarmAt && (
              <button className="mini-btn" onClick={() => void setAlarm(task.id, null)}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {isAgentic && (
        <section className="analysis-section">
          <div className="section-head">
            <h4>Pre-process</h4>
            <div className="row">
              {running ? (
                <>
                  <span className="badge running">working…</span>
                  {activeJob && (
                    <button className="mini-btn cancel" onClick={() => void cancelJob(activeJob.jobId)}>
                      Cancel
                    </button>
                  )}
                </>
              ) : (
                <button className="mini-btn" onClick={runPre}>
                  {preprocess ? 'Re-run' : 'Run now'}
                </button>
              )}
            </div>
          </div>

          {task.preprocessStatus === 'failed' && (
            <div className="warning-box">
              <p>Pre-process failed: {task.preprocessError ?? 'unknown error'}</p>
              <button className="primary-btn" onClick={runPre}>
                Retry
              </button>
            </div>
          )}

          {running && <div className="muted live-step">{activeJob?.stepLabel ?? (task.preprocessStatus === 'queued' ? 'queued…' : 'working…')}</div>}

          {!preprocess && !running && task.preprocessStatus !== 'failed' && (
            <div className="empty-hint">
              {snapshot?.aiConfigured
                ? `No pre-process yet. Add this task to My Day to generate the ${def.kind} summary and suggestions, or click Run now.`
                : 'No pre-process yet. AI is not configured — set up a provider in Settings first.'}
            </div>
          )}

          {preprocess && (
            <div className="analysis-cards">
              {preprocess.generatedPrompt && (
                <PreCard kind="prompt" title="Working prompt">
                  <p className="generated-prompt">{preprocess.generatedPrompt}</p>
                </PreCard>
              )}
              {preprocess.summary && (
                <PreCard kind="summary" title="Summary">
                  <p>{preprocess.summary}</p>
                </PreCard>
              )}
              {preprocess.suggestions.length > 0 && (
                <PreCard kind="suggest" title="Activity suggestions">
                  <ul>
                    {preprocess.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </PreCard>
              )}
            </div>
          )}
        </section>
      )}

      {isAgentic && !task.completed && (
        <div className="finish-row">
          <button className="finish-btn" onClick={() => void handleFinishClick()}>
            {def.kind === 'learning' ? 'Finish → ingest to wiki' : 'Finish'}
          </button>
        </div>
      )}
      {dialog}
    </div>
  )
}

// Pre-process output card with iconified header + accent rail (reuses the v2
// analysis-card visuals).
function PreCard({ kind, title, children }: { kind: 'prompt' | 'summary' | 'suggest'; title: string; children: React.ReactNode }) {
  const cls = kind === 'summary' ? 'accent-blue' : kind === 'suggest' ? 'accent-ok' : ''
  const glyph = kind === 'prompt' ? 'P' : kind === 'summary' ? 'S' : 'A'
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
