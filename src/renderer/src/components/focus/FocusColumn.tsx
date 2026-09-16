import { useState } from 'react'
import { useApp } from '../../store'
import { useLanguage, useT } from '../../lib/useT'
import { displayTypeLabel } from '../../lib/typeCatalog'
import { TaskBand } from './TaskBand'
import { TaskNotes } from './TaskNotes'
import { JiraArea } from './JiraArea'
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconTarget } from '../ui/icons'
import { effectiveType } from '../../lib/typeCatalog'
import { workingAreaFor, type WorkingArea } from '../../../../core/domain/workingArea'

// The category selects the working surface (spec scope boundary: per-type
// working-area declaration is out of scope). The mapping is an explicit table
// rather than a ternary, so a new category is an entry here instead of another
// branch in a component.
const WorkingAreaView: Record<WorkingArea, (task: Parameters<typeof TaskNotes>[0]['task']) => JSX.Element> = {
  notes: (task) => <TaskNotes task={task} />,
  markdown: (task) => <TaskNotes task={task} />,
  'source-panel': (task) => <JiraArea task={task} />
}

interface Props {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}

// Focus column — the third column of the board (spec app-layout). Renders only
// while a task is selected: a collapsible AI band (TaskBand) over a working
// area (TaskNotes). Whole-column collapse state is owned by App so a new
// selection reopens it; band collapse is local (reset by remounting on task).
export function FocusColumn({ collapsed, onExpand, onCollapse }: Props) {
  const { selectedTaskId, taskById, snapshot } = useApp()
  const t = useT()
  const language = useLanguage()
  const task = selectedTaskId ? taskById(selectedTaskId) : undefined
  const [bandCollapsed, setBandCollapsed] = useState(false)

  if (!task) {
    // No task selected — the focus column stays mounted with an empty prompt
    // (spec app-layout) so the three columns persist.
    return (
      <aside className="focus-col">
        <div className="detail-empty focus-empty">
          <IconTarget />
          <p>{t('focus.empty')}</p>
        </div>
      </aside>
    )
  }

  if (collapsed) {
    return (
      <aside className="focus-col collapsed">
        <button className="collapse-btn open" onClick={onExpand} title={t('focus.show')}>
          ▶
        </button>
      </aside>
    )
  }

  const meta = effectiveType(task, snapshot?.taskTypes)
  const listName = snapshot?.lists.find((l) => l.id === task.listId)?.name ?? 'Inbox'

  return (
    <aside className="focus-col">
      <div className="focus-col-inner" key={task.id}>
        <div className="focus-toolbar">
          <span className="focus-label">
            <span className="f-breadcrumb">
              <span className="crumb">{listName}</span>
              <span className="sep">›</span>
              <span className="crumb">{displayTypeLabel(meta, language)}</span>
              <span className="sep">›</span>
              <span className="crumb" style={{ fontFamily: 'var(--font-mono)' }}>#{task.id.slice(0, 6)}</span>
            </span>
          </span>
          <div className="row">
            <button
              className="focus-ctrl-btn"
              onClick={() => setBandCollapsed((b) => !b)}
              title={bandCollapsed ? t('focus.ai.show') : t('focus.ai.hide')}
            >
              {bandCollapsed ? `▾ ${t('focus.ai.showLabel')}` : `▴ ${t('focus.ai.hideLabel')}`}
            </button>
            <button className="collapse-btn" onClick={onCollapse} title={t('focus.hide')}>
              ◀
            </button>
          </div>
        </div>
        {!bandCollapsed && (
          <div className="focus-band">
            <TaskBand task={task} />
          </div>
        )}
        <div className={`focus-work ${bandCollapsed ? 'full' : ''}`}>
          {WorkingAreaView[workingAreaFor(meta.kind)](task)}
        </div>
      </div>
    </aside>
  )
}
