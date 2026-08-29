import { useApp } from '../store'
import { TaskRow } from './TaskRow'

export function MyDayView() {
  const { myDayTasks, selectTask, jobSteps } = useApp()
  const open = myDayTasks.filter((t) => !t.completed)
  const done = myDayTasks.filter((t) => t.completed)

  return (
    <div className="view">
      <div className="view-head">
        <h2>My Day</h2>
        <span className="muted">Completed tasks clear on the next day; open tasks stay.</span>
      </div>
      {myDayTasks.length === 0 && (
        <div className="empty-hint">Nothing planned for today. Add a task to My Day to get focused.</div>
      )}
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
