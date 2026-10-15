import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { MessageKey } from '../../../../core/i18n'
import { ActivityView } from './ActivityView'
import { SettingsView } from './SettingsView'

// Each drawer's heading, as keys rather than text: the title and subtitle are
// looked up when the drawer opens, so they follow the language like the rest.
//
// The debug-chat drawer is retired (T027/T029): conversations are task-owned
// stored state and live in the focus column's Chat tab, on every task.
const TITLES: Record<'activity' | 'settings', { title: MessageKey; sub: MessageKey }> = {
  activity: { title: 'drawer.activity.title', sub: 'drawer.activity.sub' },
  settings: { title: 'drawer.settings.title', sub: 'drawer.settings.sub' }
}

// Drawer host (spec app-layout): Activity and Settings open as right-side
// drawers overlaying the board, which stays mounted behind them.
export function DrawerHost() {
  const { drawer, closeDrawer } = useApp()
  const t = useT()
  if (!drawer) return null

  const { title, sub } = TITLES[drawer]

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={closeDrawer} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{t(title)}</h2>
            <div className="drawer-sub">{t(sub)}</div>
          </div>
          <button className="mini-btn" onClick={closeDrawer}>
            ✕ {t('common.close')}
          </button>
        </div>
        <div className="drawer-body">
          {drawer === 'activity' && <ActivityView />}
          {drawer === 'settings' && <SettingsView />}
        </div>
      </aside>
    </div>
  )
}
