import { useApp } from '../../store'
import { ActivityView } from './ActivityView'
import { SettingsView } from './SettingsView'
import { ChatView } from './ChatView'

const TITLES: Record<'activity' | 'settings' | 'chat', { title: string; sub: string }> = {
  activity: { title: 'Activity', sub: 'agent jobs · ingest history · live progress' },
  settings: { title: 'Settings', sub: 'ai provider · theme · preferences' },
  chat: { title: 'Debug chat', sub: 'agent session · stream events' }
}

// Drawer host (spec app-layout): Activity, Settings, and the debug chat open
// as right-side drawers overlaying the board, which stays mounted behind them.
export function DrawerHost() {
  const { drawer, closeDrawer } = useApp()
  if (!drawer) return null

  const { title, sub } = TITLES[drawer]

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={closeDrawer} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            <div className="drawer-sub">{sub}</div>
          </div>
          <button className="mini-btn" onClick={closeDrawer}>
            ✕ Close
          </button>
        </div>
        <div className="drawer-body">
          {drawer === 'activity' && <ActivityView />}
          {drawer === 'settings' && <SettingsView />}
          {drawer === 'chat' && <ChatView />}
        </div>
      </aside>
    </div>
  )
}
