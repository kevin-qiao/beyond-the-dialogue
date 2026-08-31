import { useState } from 'react'
import { useApp } from '../store'
import { useDialog } from './Dialog'

export function Sidebar({ onNewTask }: { onNewTask: () => void }) {
  const { snapshot, activeView, setActiveView, selectList, selectedListId, createList, renameList, deleteList, liveJobs, activity, ingestSteps } =
    useApp()
  const [newListName, setNewListName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const { confirm, dialog } = useDialog()

  // Agent presence line (spec agent-presence): idle / working (with live
  // step) / queued count; clicking opens Activity.
  const jobs = Object.values(liveJobs)
  const runningJob = jobs.find((j) => j.state === 'running')
  const runningIngest = (activity ?? []).find((r) => r.state === 'running')
  const queuedCount = jobs.filter((j) => j.state === 'queued').length + (activity ?? []).filter((r) => r.state === 'queued').length

  const lists = snapshot?.lists ?? []

  const handleCreate = async () => {
    if (!newListName.trim()) return
    const l = await createList(newListName.trim())
    setNewListName('')
    setAdding(false)
    selectList(l.id)
    setActiveView('list')
  }

  const handleRename = async (id: string) => {
    if (editValue.trim() && editValue.trim() !== lists.find((l) => l.id === id)?.name) {
      await renameList(id, editValue.trim())
    }
    setEditing(null)
  }

  const handleDelete = async (id: string) => {
    const list = lists.find((l) => l.id === id)
    const ok = await confirm({
      title: 'Delete list',
      message: `Delete "${list?.name ?? 'this list'}" and all its tasks? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) {
      await deleteList(id)
      if (selectedListId === id) selectList(null)
    }
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <button className="new-task-btn" onClick={onNewTask}>
          ＋ New task
        </button>
      </div>

      <button
        className={`nav-item ${activeView === 'my-day' ? 'active' : ''}`}
        onClick={() => {
          setActiveView('my-day')
          selectList(null)
        }}
      >
        My Day
      </button>

      <div className="sidebar-label">
        Lists
        <button className="mini-btn" onClick={() => setAdding(true)}>
          +
        </button>
      </div>

      {adding && (
        <div className="new-list-row">
          <input
            autoFocus
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="List name"
          />
        </div>
      )}

      {lists.map((l) => (
        <div key={l.id} className={`nav-item ${activeView === 'list' && selectedListId === l.id ? 'active' : ''}`}>
          {editing === l.id ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => void handleRename(l.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename(l.id)
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span
              className="nav-item-label"
              onDoubleClick={() => {
                setEditing(l.id)
                setEditValue(l.name)
              }}
              onClick={() => {
                selectList(l.id)
                setActiveView('list')
              }}
            >
              {l.name}
              <span
                className="nav-delete"
                role="button"
                title="Delete list"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(l.id)
                }}
              >
                ×
              </span>
            </span>
          )}
        </div>
      ))}

      <div className="sidebar-foot">
        <button className={`nav-item ${activeView === 'activity' ? 'active' : ''}`} onClick={() => setActiveView('activity')}>
          Activity
        </button>
        <button className={`nav-item ${activeView === 'chat' ? 'active' : ''}`} onClick={() => setActiveView('chat')}>
          💬 Chat
        </button>
        <button className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>
          Settings
        </button>
        <div className="ai-status" onClick={() => setActiveView('activity')} title="Agent status — open Activity">
          {runningJob ? (
            <span className="ai-working">○ {runningJob.stepLabel ?? 'working…'}</span>
          ) : runningIngest ? (
            <span className="ai-working">○ {ingestSteps[runningIngest.id] ?? 'ingesting…'}</span>
          ) : queuedCount > 0 ? (
            <span className="ai-queued">○ {queuedCount} job{queuedCount > 1 ? 's' : ''} queued</span>
          ) : snapshot?.aiConfigured ? (
            <span className="ai-on">● AI ready — agent idle</span>
          ) : (
            <span className="ai-off">● AI not configured</span>
          )}
        </div>
      </div>
      {dialog}
    </nav>
  )
}
