import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { ListView } from './components/ListView'
import { MyDayView } from './components/MyDayView'
import { ActivityView } from './components/ActivityView'
import { SettingsView } from './components/SettingsView'
import { TaskDetail } from './components/TaskDetail'
import { NewTaskForm } from './components/NewTaskForm'
import { useState } from 'react'

export function App() {
  const { loading, snapshot, activeView, selectedTaskId, selectedListId, taskById, toast, dismissToast } = useApp()
  const [showNewTask, setShowNewTask] = useState(false)

  if (loading || !snapshot) {
    return <div className="app-loading">Loading…</div>
  }

  const selectedTask = selectedTaskId ? taskById(selectedTaskId) : undefined

  return (
    <div className="app">
      <Sidebar onNewTask={() => setShowNewTask(true)} />
      <main className="main">
        <div className="content-col">
          {activeView === 'my-day' && <MyDayView />}
          {activeView === 'list' && <ListView onNewTask={() => setShowNewTask(true)} />}
          {activeView === 'activity' && <ActivityView />}
          {activeView === 'settings' && <SettingsView />}
          {showNewTask && (
            <NewTaskForm listId={selectedListId ?? snapshot.lists[0]?.id ?? ''} onClose={() => setShowNewTask(false)} />
          )}
        </div>
        <aside className="detail-col">
          {selectedTask ? <TaskDetail task={selectedTask} /> : <div className="detail-empty">Select a task to see details</div>}
        </aside>
      </main>
      {toast && (
        <div className="toast" onClick={dismissToast}>
          {toast}
        </div>
      )}
    </div>
  )
}
