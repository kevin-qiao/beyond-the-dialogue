import { useEffect, useState } from 'react'
import { useApp } from './store'
import { ListsRail } from './components/board/ListsRail'
import { TaskColumn } from './components/board/TaskColumn'
import { FocusColumn } from './components/focus/FocusColumn'
import { DrawerHost } from './components/overlays/DrawerHost'
import { WelcomeView } from './components/overlays/WelcomeView'
import { CommandPalette } from './components/overlays/CommandPalette'

// Small circular progress ring used in the topbar to show today's completion
// ratio. Clickable — jumps back to My Day view.
function TodayProgress({ done, total, onClick }: { done: number; total: number; onClick: () => void }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const r = 9
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  const complete = total > 0 && done >= total
  return (
    <button
      className={`today-ring ${complete ? 'complete' : ''}`}
      onClick={onClick}
      title={`My Day · ${done}/${total} done`}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={r} stroke="var(--surface-3)" strokeWidth="2" fill="none" />
        <circle
          cx="11"
          cy="11"
          r={r}
          stroke={complete ? 'var(--ok)' : 'var(--accent)'}
          strokeWidth="2"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
          style={{ transition: 'stroke-dashoffset var(--t-med) var(--ease)' }}
        />
      </svg>
      <span className="pct">{pct}%</span>
      <span style={{ color: 'var(--text-faint)' }}>today</span>
    </button>
  )
}

// Board shell (spec app-layout / theme / first-run): a persistent three-column
// board — ListsRail | TaskColumn | FocusColumn — under a top bar that hosts
// global search and the drawer entry points. Activity/Settings/Chat are
// drawers (DrawerHost); on first run a welcome overlay sits above the board.
export function App() {
  const { loading, snapshot, selectedTaskId, toast, dismissToast, setActiveView, openDrawer, query, setQuery, saveSettings } = useApp()
  // Whole focus-column collapse is App-local state — deliberately not in the
  // shared context (a context/memo staleness bug left it unrenderable).
  const [focusCollapsed, setFocusCollapsed] = useState(false)
  // Command palette (⌘K) — App-local so a stale context never strands it open.
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Selecting a task reopens a collapsed focus column.
  useEffect(() => {
    if (selectedTaskId) setFocusCollapsed(false)
  }, [selectedTaskId])

  // Global shortcuts (spec task-capture / app-layout): n / Ctrl+N focuses the
  // quick-add capture, Ctrl/Cmd+K opens the command palette. Ignored while
  // typing inside an input/textarea/select/contentEditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const editing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (editing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        openDrawer('settings')
        return
      }
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveView, openDrawer])

  if (loading || !snapshot) {
    return <div className="app-loading" data-theme={snapshot?.settings.theme ?? 'light'}>Loading…</div>
  }

  const showWelcome = snapshot.settings.showWelcome && !snapshot.aiConfigured

  return (
    <div className="app" data-theme={snapshot.settings.theme}>
      <header className="topbar">
        <a className="logo" href="#" onClick={(e) => e.preventDefault()}>
          <span className="mark">BeTD</span>
          <span className="name">Beyond the Dialogue</span>
          <span className="tag">v2 · preview</span>
        </a>

        {snapshot && (
          <TodayProgress
            done={snapshot.tasks.filter((t) => t.inMyDay && t.completed).length}
            total={snapshot.tasks.filter((t) => t.inMyDay).length}
            onClick={() => {
              setActiveView('my-day')
            }}
          />
        )}

        <div
          className="search-wrap"
          role="button"
          tabIndex={0}
          title="Command palette (⌘K) — click the icon or ⌘K"
          // Only the icon / kbd hint / wrap-background open the palette; clicking
          // directly in the input keeps the live filter UX untouched.
          onMouseDown={(e) => {
            const t = e.target as HTMLElement
            if (t.tagName !== 'INPUT') setPaletteOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setPaletteOpen(true)
            }
          }}
        >
          <span className="search-icon">⌕</span>
          <input
            id="global-search"
            className="search-input"
            placeholder="Search tasks, notes, summaries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              className="mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                setQuery('')
              }}
            >
              ✕ clear
            </button>
          ) : (
            <span className="kbd-hint">⌘K</span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-btn top-action ${snapshot && snapshot.ingestHistory.some((r) => r.state === 'running') ? 'has-dot' : ''}`}
            title="Activity — agent work"
            onClick={() => openDrawer('activity')}
          >
            ▤
          </button>
          <button className="icon-btn top-action" title="Debug chat" onClick={() => openDrawer('chat')}>
            💬
          </button>
          <button
            className="icon-btn top-action"
            title={snapshot?.settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() =>
              void saveSettings({ ...snapshot.settings, theme: snapshot.settings.theme === 'light' ? 'dark' : 'light' })
            }
          >
            {snapshot?.settings.theme === 'light' ? '☾' : '☀'}
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {toast && (
        <div className="toast" onClick={dismissToast}>
          <span className="toast-icon">✓</span>
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
