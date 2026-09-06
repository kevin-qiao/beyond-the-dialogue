import { useState } from 'react'
import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { allTypeConfigs, effectiveType } from '../../lib/typeCatalog'
import { TaskInputsForm } from './TaskInputsForm'

// Task form (modal) used for both creating a new task and editing an existing
// one. In edit mode it pre-fills title/notes/type/inputs from the task and
// updates it; in create mode it targets the scope's list. Switching type
// clears the per-type inputs (main re-validates on save). The list itself is
// no longer surfaced (lists are hidden behind My Day / To Do).
export function TaskForm({ listId, task, onClose }: { listId: string; task?: Task; onClose: () => void }) {
  const { snapshot, types, createTask, updateTask, setActiveView } = useApp()
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [typeKey, setTypeKey] = useState<string>(task ? effectiveType(task, types).key : 'plain')
  const [inputs, setInputs] = useState<Record<string, unknown>>(task?.inputs ?? {})
  const [error, setError] = useState<string | null>(null)

  const configs = allTypeConfigs(types)
  const def = configs.find((c) => c.key === typeKey) ?? configs[0]!

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    const patch = {
      title: title.trim(),
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
      setError(e?.message ?? 'Could not save the task')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">{isEdit ? '✎ Edit' : '＋ New'}</span>
          <h3>{isEdit ? 'Edit task' : 'New task'}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label>
            Title
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
          </label>
          <label>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional details" rows={3} />
          </label>
          <label>
            Type
            <select
              value={typeKey}
              onChange={(e) => {
                setTypeKey(e.target.value)
                setInputs({})
              }}
            >
              {configs.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.emoji} {c.label}{c.isBuiltin ? '' : '（custom）'}
                </option>
              ))}
            </select>
          </label>
          {def.inputSchema.length > 0 && (
            <TaskInputsForm def={def} values={inputs} onChange={setInputs} settings={snapshot?.settings} />
          )}
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => void submit()}>
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
