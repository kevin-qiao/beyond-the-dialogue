import { useState } from 'react'
import { useApp } from '../../store'
import { allTypeConfigs } from '../../lib/typeCatalog'
import { TaskInputsForm } from './TaskInputsForm'

// New-task modal (spec task-capture / task-types): the type picker lists the
// full registry; the selected type's declared inputs render generically from
// its inputSchema. Switching type clears the per-type inputs (spec: shared
// fields survive, type-specific values are discarded — main enforces).
export function NewTaskForm({ listId, onClose }: { listId: string; onClose: () => void }) {
  const { snapshot, types, createTask, selectList, setActiveView } = useApp()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [typeKey, setTypeKey] = useState<string>('plain')
  const [inputs, setInputs] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState(listId)

  const configs = allTypeConfigs(types)
  const def = configs.find((c) => c.key === typeKey) ?? configs[0]!

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    try {
      await createTask({
        listId: list,
        title: title.trim(),
        notes: notes.trim(),
        type: def.isBuiltin ? (def.key as 'plain' | 'learning' | 'jira') : 'plain',
        customTypeKey: def.isBuiltin ? null : def.key,
        inputs
      })
      selectList(list)
      setActiveView('list')
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Could not create the task')
    }
  }

  const lists = snapshot?.lists ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">＋ New</span>
          <h3>New task</h3>
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
            List
            <select value={list} onChange={(e) => setList(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
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
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
