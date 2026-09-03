import { useState } from 'react'
import { useApp } from '../store'
import type { Task } from '../../../shared/types'
import { TaskRow } from './TaskRow'
import { QuickAdd } from './QuickAdd'
import { NewTaskForm } from './NewTaskForm'

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
  const { snapshot, activeView, selectedListId, selectTask, jobSteps, query, searchTasks, tasksForList, myDayTasks } = useApp()
  const [showNewTask, setShowNewTask] = useState(false)

  const lists = snapshot?.lists ?? []
  const defaultListId = snapshot?.defaultListId ?? lists[0]?.id ?? null
  const selectedList = lists.find((l) => l.id === selectedListId) ?? null
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
    // List mode (or, with no list selected, every list).
    const base = selectedList ? tasksForList(selectedList.id) : snapshot?.tasks ?? []
    const tasks = searchTasks(base)
    scope = {
      header: selectedList?.name ?? (q ? 'All tasks' : lists.length ? 'All tasks' : 'No list'),
      tasks,
      captureListId: selectedList?.id ?? defaultListId
    }
  }

  const open = scope.tasks.filter((t) => !t.completed)
  const done = scope.tasks.filter((t) => t.completed)
  const showCapture = !!scope.captureListId && !q

  return (
    <div className="task-column">
      <div className="view-head task-col-head">
        <div className="task-col-title">
          <h2>{scope.header}</h2>
          {scope.dateSub && (
            <span className="muted">
              {scope.dateSub}
              {scope.rollover && ' · completed clear next day, open tasks stay'}
            </span>
          )}
        </div>
        {scope.captureListId && (
          <button className="primary-btn new-task-btn-col" onClick={() => setShowNewTask(true)} title={`New task in ${selectedList?.name ?? 'the default list'}`}>
            ＋ New task
          </button>
        )}
      </div>

      {showCapture && <QuickAdd listId={scope.captureListId!} onCreated={() => setShowNewTask(false)} />}
      {scope.tasks.length === 0 && (
        <div className="empty-hint">
          {q ? 'No tasks match your search.' : activeView === 'my-day' ? 'Nothing planned for today. Add a task to My Day to get focused.' : 'This list is empty. Add a task to get started.'}
        </div>
      )}
      <div className="task-list">
        {open.map((t) => (
          <TaskRow key={t.id} task={t} jobStep={jobSteps[t.id] ?? null} onSelect={() => selectTask(t.id)} />
        ))}
        {done.map((t) => (
          <TaskRow key={t.id} task={t} jobStep={jobSteps[t.id] ?? null} onSelect={() => selectTask(t.id)} />
        ))}
      </div>

      {showNewTask && scope.captureListId && <NewTaskForm listId={scope.captureListId} onClose={() => setShowNewTask(false)} />}
    </div>
  )
}
