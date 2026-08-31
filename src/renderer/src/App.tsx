import { useEffect, useState } from 'react'
import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { ListView } from './components/ListView'
import { MyDayView } from './components/MyDayView'
import { ActivityView } from './components/ActivityView'
import { SettingsView } from './components/SettingsView'
import { TaskDetail } from './components/TaskDetail'
import { NewTaskForm } from './components/NewTaskForm'
import { WelcomeView } from './components/WelcomeView'
import { ChatView } from './components/ChatView'

export function App() {
  const {
    loading,
    snapshot,
    activeView,
    selectedTaskId,
    selectedListId,
    taskById,
    toast,
    dismissToast,
    setActiveView,
    query,
    setQuery,
    detailCollapsed,
    toggleDetailCollapsed
  } = useApp()
  const [showNewTask, setShowNewTask] = useState(false)

  // Global shortcuts (spec task-capture / app-layout): n / Ctrl+N focuses the
  // quick-add capture, Ctrl+K focuses search. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const editing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (editing) return
      if (e.key === 'n' || (e.ctrlKey && e.key.toLowerCase() === 'n')) {
        e.preventDefault()
        const el = document.getElementById('quick-add')
        if (el) el.focus()
        else setActiveView('list')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('global-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveView])

  if (loading || !snapshot) {
    return <div className="app-loading">Loading…</div>
  }

  const selectedTask = selectedTaskId ? taskById(selectedTaskId) : undefined

  return (
    <div className="app">
      <header className="topbar">
        <span className="app-title">Work Board</span>
        <div className="search-wrap">
          <input
            id="global-search"
            className="search-input"
            placeholder="Search tasks, papers, TLDRs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button className="mini-btn" onClick={() => setQuery('')}>
              ✕ clear
            </button>
          ) : (
            <span className="kbd-hint">Ctrl+K</span>
          )}
        </div>
      </header>
      <div className="app-body">
        <Sidebar onNewTask={() => setShowNewTask(true)} />
        <main className="main">
          <div className="content-col">
          {activeView === 'settings' ? (
            <SettingsView />
          ) : snapshot.settings.showWelcome ? (
            <WelcomeView />
          ) : (
            <>
              {activeView === 'my-day' && <MyDayView />}
              {activeView === 'list' && <ListView onNewTask={() => setShowNewTask(true)} />}
              {activeView === 'activity' && <ActivityView />}
              {activeView === 'chat' && <ChatView />}
            </>
          )}
          {showNewTask && (
            <NewTaskForm listId={selectedListId ?? snapshot.lists[0]?.id ?? ''} onClose={() => setShowNewTask(false)} />
          )}
        </div>
        <aside className={`detail-col ${selectedTask ? (detailCollapsed ? 'collapsed' : '') : 'hidden'}`}>
          {selectedTask && detailCollapsed && (
            <button className="collapse-btn open" onClick={() => toggleDetailCollapsed(false)} title="Show details">
              ▶
            </button>
          )}
          {selectedTask && !detailCollapsed && (
            <>
              <button className="collapse-btn" onClick={() => toggleDetailCollapsed(true)} title="Hide details">
                ◀
              </button>
              <TaskDetail task={selectedTask} />
            </>
          )}
        </aside>
        </main>
      </div>
      {toast && (
        <div className="toast" onClick={dismissToast}>
          <span className="toast-msg">{toast.message}</span>
          {toast.view && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation()
                dismissToast()
                setActiveView(toast.view!)
              }}
            >
              View
            </button>
          )}
        </div>
      )}
    </div>
  )
}
