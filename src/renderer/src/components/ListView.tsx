import { useApp } from '../store'
import { TaskRow } from './TaskRow'
import { QuickAdd } from './QuickAdd'

export function ListView({ onNewTask }: { onNewTask: () => void }) {
  const { snapshot, selectedListId, tasksForList, selectTask, jobSteps, query, searchTasks } = useApp()
  const list = snapshot?.lists.find((l) => l.id === selectedListId) ?? snapshot?.lists[0]
  // Cross-list search: with no specific list selected, a query spans all lists.
  const base = selectedListId === null && query.trim() ? snapshot?.tasks ?? [] : tasksForList(list?.id ?? '')
  const tasks = searchTasks(base)
  const open = tasks.filter((t) => !t.completed)
  const done = tasks.filter((t) => t.completed)
  const header = selectedListId === null && query.trim() ? 'All tasks' : list?.name ?? 'No list'

  return (
    <div className="view">
      <div className="view-head">
        <h2>{header}</h2>
        <button className="primary-btn" onClick={onNewTask}>
          More options
        </button>
      </div>
      {list && <QuickAdd listId={list.id} />}
      {tasks.length === 0 && <div className="empty-hint">This list is empty. Add a task to get started.</div>}
      <div className="task-list">
        {open.map((t) => (
          <TaskRow key={t.id} task={t} jobStep={jobSteps[t.id] ?? null} onSelect={() => selectTask(t.id)} />
        ))}
        {done.map((t) => (
          <TaskRow key={t.id} task={t} jobStep={jobSteps[t.id] ?? null} onSelect={() => selectTask(t.id)} />
        ))}
      </div>
    </div>
  )
}
