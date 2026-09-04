import { useState } from 'react'
import { useApp } from '../../store'
import { allTypeConfigs } from '../../lib/typeCatalog'

export function NewTaskForm({ listId, onClose }: { listId: string; onClose: () => void }) {
  const { createTask, snapshot, selectList, setActiveView } = useApp()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  // Selected type key — built-in ('plain' / 'paper_reading') or custom.
  const [typeKey, setTypeKey] = useState<string>('plain')
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState(listId)

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    const isBuiltin = typeKey === 'plain' || typeKey === 'paper_reading'
    const customKey = isBuiltin ? null : typeKey
    const builtinType = isBuiltin ? (typeKey as 'plain' | 'paper_reading') : 'plain'
    await createTask({
      listId: list,
      title: title.trim(),
      notes: notes.trim(),
      type: builtinType,
      customTypeKey: customKey,
      link: builtinType === 'paper_reading' ? link.trim() : undefined
    })
    selectList(list)
    setActiveView('list')
    onClose()
  }

  const lists = snapshot?.lists ?? []
  const configs = allTypeConfigs(snapshot?.settings)
  const effectiveBuiltin = typeKey === 'paper_reading' ? 'paper_reading' : 'plain'

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
            <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
              {(snapshot?.settings?.customTypes ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.emoji} {c.label}（自定义）
                </option>
              ))}
              <option value="plain">📝 Plain task</option>
              <option value="paper_reading">📄 Paper reading</option>
            </select>
          </label>
          {effectiveBuiltin === 'paper_reading' && (
            <label>
              Paper link <span className="muted">(optional — attach a local PDF instead)</span>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://arxiv.org/abs/…" />
            </label>
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
