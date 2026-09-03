import { useEffect, useState } from 'react'
import { useApp } from './store'
import { ListsRail } from './components/ListsRail'
import { TaskColumn } from './components/TaskColumn'
import { FocusColumn } from './components/FocusColumn'
import { DrawerHost } from './components/DrawerHost'
import { WelcomeView } from './components/WelcomeView'

// Board shell (spec app-layout / theme / first-run): a persistent three-column
// board — ListsRail | TaskColumn | FocusColumn — under a top bar that hosts
// global search and the drawer entry points. Activity/Settings/Chat are
// drawers (DrawerHost); on first run a welcome overlay sits above the board.
export function App() {
  const { loading, snapshot, selectedTaskId, toast, dismissToast, setActiveView, openDrawer, query, setQuery, saveSettings } = useApp()
  // Whole focus-column collapse is App-local state — deliberately not in the
  // shared context (a context/memo staleness bug left it unrenderable).
  const [focusCollapsed, setFocusCollapsed] = useState(false)

  // Selecting a task reopens a collapsed focus column.
  useEffect(() => {
    if (selectedTaskId) setFocusCollapsed(false)
  }, [selectedTaskId])

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
        if (el) {
          // #quick-add is the capture <form>; focus its input (form.focus() is a no-op).
          const input = el.querySelector('input') ?? el
          ;(input as HTMLElement).focus()
        } else {
          setActiveView('my-day')
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('global-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveView])

  if (loading || !snapshot) {
    return <div className="app-loading" data-theme={snapshot?.settings.theme ?? 'light'}>Loading…</div>
  }

  const showWelcome = snapshot.settings.showWelcome && !snapshot.aiConfigured

  return (
    <div className="app" data-theme={snapshot.settings.theme}>
      <header className="topbar">
        <a className="logo" href="#" onClick={(e) => e.preventDefault()}>
          <span className="mark">WB</span>
          <span className="name">Work Board</span>
        </a>
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
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
            <span className="kbd-hint">Ctrl K</span>
          )}
        </div>
        <div className="topbar-actions">
          <button className="icon-btn top-action" title="Activity — agent work" onClick={() => openDrawer('activity')}>
            ▤
          </button>
          <button className="icon-btn top-action" title="Debug chat" onClick={() => openDrawer('chat')}>
            💬
          </button>
          <button
            className="icon-btn top-action"
            title={snapshot.settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() =>
              void saveSettings({ ...snapshot.settings, theme: snapshot.settings.theme === 'light' ? 'dark' : 'light' })
            }
          >
            {snapshot.settings.theme === 'light' ? '☾' : '☀'}
          </button>
          <button className="icon-btn top-action" title="Settings" onClick={() => openDrawer('settings')}>
            ⚙
          </button>
        </div>
      </header>
      <div className="app-body board-body">
        <ListsRail />
        <main className="main board-main">
          <TaskColumn />
          <FocusColumn
            collapsed={focusCollapsed}
            onExpand={() => setFocusCollapsed(false)}
            onCollapse={() => setFocusCollapsed(true)}
          />
        </main>
      </div>

      {showWelcome && (
        <div className="welcome-overlay">
          <WelcomeView onOpenSettings={() => openDrawer('settings')} />
        </div>
      )}

      <DrawerHost />

      {toast && (
        <div className="toast" onClick={dismissToast}>
          <span className="toast-msg">{toast.message}</span>
          {toast.view && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation()
                dismissToast()
                openDrawer('activity')
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
