import { useState } from 'react'
import { useApp } from '../store'
import { TaskBand } from './TaskBand'
import { TaskNotes } from './TaskNotes'
import { typeMeta } from './status'

interface Props {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}

// Focus column — the third column of the board (spec app-layout). Renders only
// while a task is selected: a collapsible AI band (TaskBand) over a working
// area (TaskNotes). Whole-column collapse state is owned by App so a new
// selection reopens it; band collapse is local (reset by remounting on task).
export function FocusColumn({ collapsed, onExpand, onCollapse }: Props) {
  const { selectedTaskId, taskById, snapshot } = useApp()
  const task = selectedTaskId ? taskById(selectedTaskId) : undefined
  const [bandCollapsed, setBandCollapsed] = useState(false)

  if (!task) {
    // No task selected — the focus column stays mounted with an empty prompt
    // (spec app-layout) so the three columns persist.
    return (
      <aside className="focus-col">
        <div className="detail-empty focus-empty">Select a task to open its AI band and working area.</div>
      </aside>
    )
  }

  if (collapsed) {
    return (
      <aside className="focus-col collapsed">
        <button className="collapse-btn open" onClick={onExpand} title="Show task focus">
          ▶
        </button>
      </aside>
    )
  }

  const meta = typeMeta(task.type)
  const listName = snapshot?.lists.find((l) => l.id === task.listId)?.name ?? 'Inbox'

  return (
    <aside className="focus-col">
      <div className="focus-col-inner" key={task.id}>
        <div className="focus-toolbar">
          <span className="focus-label">
            <span className="f-breadcrumb">
              <span className="crumb">{listName}</span>
              <span className="sep">›</span>
              <span className="crumb">{meta.label}</span>
              <span className="sep">›</span>
              <span className="crumb" style={{ fontFamily: 'var(--font-mono)' }}>#{task.id.slice(0, 6)}</span>
            </span>
          </span>
          <div className="row">
            <button className="focus-ctrl-btn" onClick={() => setBandCollapsed((b) => !b)} title={bandCollapsed ? 'Show AI band' : 'Hide AI band'}>
              {bandCollapsed ? '▾ show AI' : '▴ hide AI'}
            </button>
            <button className="collapse-btn" onClick={onCollapse} title="Hide focus column">
              ◀
            </button>
          </div>
        </div>
        {!bandCollapsed && (
          <div className="focus-band">
            <TaskBand task={task} />
          </div>
        )}
        <div className={`focus-work ${bandCollapsed ? 'full' : ''}`}>
          <TaskNotes task={task} />
        </div>
      </div>
    </aside>
  )
}
