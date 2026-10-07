import { useState } from 'react'
import type { Attachment, Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useLanguage, useT } from '../../lib/useT'
import { allTypeConfigs, displayTypeLabel, effectiveType, localizeTypeDef } from '../../lib/typeCatalog'
import { TaskInputsForm } from './TaskInputsForm'

/** Human size for an attachment row. Unit letters ride outside the catalog
 *  on purpose: they are symbols, not sentences — the same treatment the
 *  progress bar gives percentages. */
function formatSize(bytes: number, locale: string): string {
  const kb = bytes / 1024
  if (kb < 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kb)} KB`
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kb / 1024)} MB`
}

// Attachments section (feature 001, US1-AC2/AC3, T026). It renders for the
// board alone — no assistant coupling, visible regardless of the switch.
// The file dialog opens in MAIN (`attachments:add-from-dialog`), so the
// renderer never handles a source path; refusals arrive as localized messages
// and the task keeps its other content.
function AttachmentsSection({ task }: { task: Task }) {
  const { taskById, notify, locale } = useApp()
  const t = useT()
  const [busy, setBusy] = useState(false)
  // Read the aggregate live: add/remove re-broadcast the task, and the form
  // must show what the board just stored, not what it opened with.
  const attachments: Attachment[] = taskById(task.id)?.attachments ?? task.attachments ?? []

  const add = async () => {
    setBusy(true)
    try {
      const stored = await window.api.attachmentsAddFromDialog({ taskId: task.id })
      // null = the user backed out of the dialog — not a refusal, nothing to
      // report; the store merge arrives through ev:task-updated.
      if (stored) notify(t('attachment.added'))
    } catch (e: any) {
      notify(e?.message ?? t('attachment.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Attachment) => {
    setBusy(true)
    try {
      await window.api.attachmentsRemove({ attachmentId: a.id })
    } catch (e: any) {
      notify(e?.message ?? t('attachment.remove'))
    } finally {
      setBusy(false)
    }
  }

  const open = async (a: Attachment) => {
    try {
      await window.api.attachmentsOpen({ attachmentId: a.id })
    } catch (e: any) {
      notify(e?.message ?? t('attachment.missing'))
    }
  }

  return (
    <div className="attachments-section">
      <div className="section-head">
        <span className="muted">{t('attachment.title')}</span>
      </div>
      {attachments.length === 0 && <div className="muted attachment-none">{t('attachment.none')}</div>}
      {attachments.map((a) => (
        <div key={a.id} className="attachment-row">
          <span className="attachment-name" title={a.name}>
            📎 {a.name}
          </span>
          <span className="muted">{formatSize(a.size, locale)}</span>
          <button className="mini-btn" disabled={busy} onClick={() => void open(a)}>
            {t('attachment.open')}
          </button>
          <button className="icon-btn tiny danger" title={t('attachment.remove')} disabled={busy} onClick={() => void remove(a)}>
            🗑
          </button>
        </div>
      ))}
      <button className="mini-btn" disabled={busy} onClick={() => void add()}>
        ＋ {t('attachment.add')}
      </button>
    </div>
  )
}

// Task form (modal) used for both creating a new task and editing an existing
// one. In edit mode it pre-fills title/notes/type/inputs from the task and
// updates it; in create mode it targets the scope's list (which may be no
// list at all — capture into the all-tasks view is legitimate, FR-006).
// Switching type clears the per-type inputs (main re-validates on save).
export function TaskForm({ listId, task, onClose }: { listId: string | null; task?: Task; onClose: () => void }) {
  const { snapshot, types, createTask, updateTask, setActiveView } = useApp()
  const t = useT()
  const language = useLanguage()
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [background, setBackground] = useState(task?.background ?? '')
  const [target, setTarget] = useState(task?.target ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [typeKey, setTypeKey] = useState<string>(task ? effectiveType(task, types).key : 'plain')
  const [inputs, setInputs] = useState<Record<string, unknown>>(task?.inputs ?? {})
  const [error, setError] = useState<string | null>(null)

  const configs = allTypeConfigs(types)
  const def = configs.find((c) => c.key === typeKey) ?? configs[0]!

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError(t('task.field.titleRequired'))
      return
    }
    const patch = {
      title: title.trim(),
      background: background.trim(),
      target: target.trim(),
      notes: notes.trim(),
      type: def.isBuiltin ? (def.key as 'plain' | 'learning' | 'jira') : 'plain',
      customTypeKey: def.isBuiltin ? null : def.key,
      inputs
    }
    try {
      if (isEdit && task) {
        await updateTask({ id: task.id, ...patch })
      } else {
        await createTask({ listId, ...patch })
        setActiveView('todo')
      }
      onClose()
    } catch (e: any) {
      setError(e?.message ?? t('task.save.failed'))
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">{isEdit ? `✎ ${t('common.edit')}` : `＋ ${t('task.modal.new')}`}</span>
          <h3>{isEdit ? t('task.modal.editTitle') : t('task.modal.newTitle')}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label>
            {t('task.field.title')}
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('task.capture.placeholder')}
            />
          </label>
          <label>
            {t('task.field.background')}
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder={t('task.field.backgroundPlaceholder')}
              rows={2}
            />
          </label>
          <label>
            {t('task.field.target')}
            <textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t('task.field.targetPlaceholder')}
              rows={2}
            />
          </label>
          <label>
            {t('task.field.notes')}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('task.field.notesPlaceholder')}
              rows={3}
            />
          </label>
          <label>
            {t('task.field.type')}
            <select
              value={typeKey}
              onChange={(e) => {
                setTypeKey(e.target.value)
                setInputs({})
              }}
            >
              {configs.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.emoji} {displayTypeLabel(c, language)}{c.isBuiltin ? '' : t('type.customSuffix')}
                </option>
              ))}
            </select>
          </label>
          {def.inputSchema.length > 0 && (
            // The declared fields render their seeded labels in the active
            // language; the form itself needs to know nothing about it.
            <TaskInputsForm
              def={localizeTypeDef(def, language)}
              values={inputs}
              onChange={setInputs}
              settings={snapshot?.settings}
            />
          )}
          {/* Attachments belong to a task that exists — edit mode only. */}
          {task && <AttachmentsSection task={task} />}
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary-btn" onClick={() => void submit()}>
            {isEdit ? t('common.save') : t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
