import { useState } from 'react'
import { useApp } from '../store'

export function NewTaskForm({ listId, onClose }: { listId: string; onClose: () => void }) {
  const { createTask, snapshot, selectList, setActiveView } = useApp()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [type, setType] = useState<'plain' | 'paper_reading'>('plain')
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState(listId)

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    const t = await createTask({
      listId: list,
      title: title.trim(),
      notes: notes.trim(),
      type,
      link: type === 'paper_reading' ? link.trim() : undefined
    })
    selectList(list)
    setActiveView('list')
    void t
    onClose()
  }

  const lists = snapshot?.lists ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New task</h3>
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
          <select value={type} onChange={(e) => setType(e.target.value as 'plain' | 'paper_reading')}>
            <option value="plain">Plain task</option>
            <option value="paper_reading">Paper reading</option>
          </select>
        </label>
        {type === 'paper_reading' && (
          <label>
            Paper link <span className="muted">(optional — attach a local PDF instead)</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://arxiv.org/abs/…" />
          </label>
        )}
        {error && <div className="error-text">{error}</div>}
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
