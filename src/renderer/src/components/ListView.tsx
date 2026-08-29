import { useApp } from '../store'
import { TaskRow } from './TaskRow'

export function ListView({ onNewTask }: { onNewTask: () => void }) {
  const { snapshot, selectedListId, tasksForList, selectTask, jobSteps } = useApp()
  const list = snapshot?.lists.find((l) => l.id === selectedListId) ?? snapshot?.lists[0]
  const tasks = tasksForList(list?.id ?? '')
  const open = tasks.filter((t) => !t.completed)
  const done = tasks.filter((t) => t.completed)

  return (
    <div className="view">
      <div className="view-head">
        <h2>{list?.name ?? 'No list'}</h2>
        <button className="primary-btn" onClick={onNewTask}>
          Add task
        </button>
      </div>
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
