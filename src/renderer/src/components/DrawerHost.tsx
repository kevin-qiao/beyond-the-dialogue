import { useApp } from '../store'
import { ActivityView } from './ActivityView'
import { SettingsView } from './SettingsView'
import { ChatView } from './ChatView'

// Drawer host (spec app-layout): Activity, Settings, and the debug chat open
// as right-side drawers overlaying the board, which stays mounted behind them.
export function DrawerHost() {
  const { drawer, closeDrawer } = useApp()
  if (!drawer) return null

  const title = drawer === 'activity' ? 'Activity' : drawer === 'settings' ? 'Settings' : 'Chat'

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={closeDrawer} />
      <aside className="drawer">
        <div className="drawer-head">
          <strong>{title}</strong>
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
