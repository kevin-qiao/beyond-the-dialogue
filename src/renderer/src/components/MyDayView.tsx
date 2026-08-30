import { useApp } from '../store'
import { TaskRow } from './TaskRow'
import { QuickAdd } from './QuickAdd'

export function MyDayView() {
  const { snapshot, myDayTasks, selectTask, jobSteps, searchTasks } = useApp()
  const tasks = searchTasks(myDayTasks)
  const open = tasks.filter((t) => !t.completed)
  const done = tasks.filter((t) => t.completed)
  const captureListId = snapshot?.defaultListId ?? snapshot?.lists[0]?.id ?? null

  return (
    <div className="view">
      <div className="view-head">
        <h2>
          My Day <span className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </h2>
      </div>
      <span className="muted rollover-hint">Completed tasks clear on the next day; open tasks stay.</span>
      {captureListId && <QuickAdd listId={captureListId} />}
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
