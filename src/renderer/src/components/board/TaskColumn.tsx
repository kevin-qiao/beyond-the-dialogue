import { useMemo, useState } from 'react'
import { useApp } from '../../store'
import type { Task } from '../../../../shared/types'
import { TaskRow } from './TaskRow'
import { QuickAdd } from './QuickAdd'
import { TaskForm } from './TaskForm'
import { TaskContextMenu } from './TaskContextMenu'
import { useDialog } from '../ui/Dialog'
import { allTypeConfigs, typeFilterKey } from '../../lib/typeCatalog'

interface Scope {
  header: string
  dateSub?: string
  rollover?: boolean
  tasks: Task[]
  captureListId: string | null
}

// Task column — the middle column of the board (spec app-layout / task-capture).
// Renders one of three scopes: search results (query active, across all lists),
// My Day (default mode), or the selected list. The header hosts "+ New task"
// and the inline quick-capture; both target the scope's list (default list in
// My Day mode) and are hidden while a search is active.
export function TaskColumn() {
  const { snapshot, activeView, selectedTaskId, selectTask, jobSteps, query, searchTasks, myDayTasks, deleteTask } = useApp()
  const [showNewTask, setShowNewTask] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const { confirm, dialog } = useDialog()

  const handleDelete = async (task: Task) => {
    setCtxMenu(null)
    const ok = await confirm({
      title: 'Delete task',
      message: `Delete "${task.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) void deleteTask(task.id)
  }

  const lists = snapshot?.lists ?? []
  const defaultListId = snapshot?.settings?.defaultListId ?? lists[0]?.id ?? null
  const q = query.trim()

  let scope: Scope
  if (q) {
    const tasks = searchTasks(snapshot?.tasks ?? [])
    scope = { header: `Search (${tasks.length})`, tasks, captureListId: null }
  } else if (activeView === 'my-day') {
    const tasks = searchTasks(myDayTasks)
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    scope = {
      header: 'My Day',
      dateSub: today,
      rollover: true,
      tasks,
      captureListId: defaultListId
    }
  } else {
    // To Do: the backlog — all tasks across lists (open grouped above done).
    const tasks = searchTasks(snapshot?.tasks ?? [])
    scope = { header: 'To Do', tasks, captureListId: defaultListId }
  }

  const open = scope.tasks.filter((t) => !t.completed)
  const done = scope.tasks.filter((t) => t.completed)
  const showCapture = !!scope.captureListId && !q

  // Type filter — derive available types from current scope so chips never show empty.
  // Group key = customTypeKey if set, else the built-in type.
  const typeStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of open) {
      const k = typeFilterKey(t)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [open])

  const filteredOpen = typeFilter ? open.filter((t) => typeFilterKey(t) === typeFilter) : open
  const filteredDone = typeFilter ? done.filter((t) => typeFilterKey(t) === typeFilter) : done

  const completedCount = done.length
  const totalCount = open.length + done.length
  const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  const isMyDay = activeView === 'my-day'

  return (
    <div className="task-column">
      <div className="view-head task-col-head">
        <div className="task-col-title">
          <h2>{scope.header}</h2>
          {scope.dateSub && (
            <span className="date-sub">{scope.dateSub}</span>
          )}
          {scope.rollover && (
            <span className="rollover-hint">completed clears next day, open tasks stay</span>
          )}
          {totalCount > 0 && (
            <div className="col-progress" aria-hidden>
              <div className="bar" style={{ width: `${pct}%` }} />
              <div className="legend">
                <span><span className="num">{completedCount}</span> done</span>
                <span><span className="num">{totalCount}</span> total · {pct}%</span>
              </div>
            </div>
          )}
        </div>
        <div className="col-header-actions">
          {scope.tasks.length > 0 && !q && <span className="count">{open.length}</span>}
          {scope.captureListId && (
            <button
              className="primary-btn new-task-btn-col"
              onClick={() => setShowNewTask(true)}
              title="New task"
            >
              ＋ New task
            </button>
          )}
        </div>
      </div>

      {showCapture && <QuickAdd listId={scope.captureListId!} onCreated={() => setShowNewTask(false)} />}

      {typeStats.length > 1 && !q && (
        <div className="type-chips">
          <button
            className={`type-chip ${!typeFilter ? 'on' : ''}`}
            onClick={() => setTypeFilter(null)}
            title="All types"
          >
            <span className="tc-emoji" aria-hidden>·</span>
            <span className="tc-label">All</span>
            <span className="count-mini">{open.length}</span>
          </button>
          {typeStats.map(([ty, n]) => {
            const cfg = allTypeConfigs(snapshot?.taskTypes).find((c) => c.key === ty)
            return (
              <button
                key={ty}
                className={`type-chip ${typeFilter === ty ? 'on' : ''}`}
                onClick={() => setTypeFilter((cur) => (cur === ty ? null : ty))}
                title={`Filter by ${cfg?.label ?? ty}`}
              >
                <span className="tc-emoji" aria-hidden>{cfg?.emoji ?? '📌'}</span>
                <span className="tc-label">{cfg?.label ?? ty}</span>
                <span className="count-mini">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {scope.tasks.length === 0 && (
        <div className="empty-hint">
          {q ? 'No tasks match your search.' : isMyDay ? 'Nothing planned for today. Add a task to My Day to get focused.' : 'To Do is empty. Add a task to get started.'}
        </div>
      )}
      <div className="task-list">
        {filteredOpen.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            jobStep={jobSteps[t.id] ?? null}
            selected={t.id === selectedTaskId}
            onSelect={() => selectTask(t.id)}
            onContextMenu={(e, task) => {
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY, task })
            }}
          />
        ))}
        {filteredDone.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            jobStep={jobSteps[t.id] ?? null}
            selected={t.id === selectedTaskId}
            onSelect={() => selectTask(t.id)}
            onContextMenu={(e, task) => {
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY, task })
            }}
          />
        ))}
      </div>

      {showNewTask && scope.captureListId && <TaskForm listId={scope.captureListId} onClose={() => setShowNewTask(false)} />}
      {editingTask && <TaskForm listId={editingTask.listId} task={editingTask} onClose={() => setEditingTask(null)} />}
      {ctxMenu && (
        <TaskContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => {
            setEditingTask(ctxMenu.task)
            setCtxMenu(null)
          }}
          onDelete={() => void handleDelete(ctxMenu.task)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {dialog}
    </div>
  )
}