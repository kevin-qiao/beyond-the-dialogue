import { useState } from 'react'
import { useApp } from '../../store'
import { useLanguage, useT } from '../../lib/useT'
import { displayTypeLabel } from '../../lib/typeCatalog'
import { TaskBand } from './TaskBand'
import { TaskNotes } from './TaskNotes'
import { ChatPanel } from './ChatPanel'
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconTarget } from '../ui/icons'
import { effectiveType } from '../../lib/typeCatalog'
import { workingAreaFor, type WorkingArea } from '../../../../core/domain/workingArea'
import { isAssistantEnabled } from '../../../../core/domain/assistant'

// The Family selects the working surface (research D1/D3): a document-family
// Type surfaces the task's note as the WORKING AREA — the writing space the
// draft lives in — while every other Type keeps the ordinary notes field. The
// Jira source-panel surface is deleted with the working-system engine (FR-016).
// The mapping is an explicit table rather than a ternary, so a new surface is
// an entry here instead of another branch in a component.
const WorkingAreaView: Record<WorkingArea, (task: Parameters<typeof TaskNotes>[0]['task']) => JSX.Element> = {
  notes: (task) => <TaskNotes task={task} />,
  markdown: (task) => <TaskNotes task={task} />
}

interface Props {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}

// Focus column — the third column of the board (spec app-layout). Renders only
// while a task is selected: a collapsible band over a working area (TaskNotes).
// The band holds the AI band (TaskBand) and — for kinds that ground a chat in
// the task — a Chat tab, so the conversation lives in the top half next to the
// pre-process outputs rather than as an editor tab. Whole-column collapse state
// is owned by App so a new selection reopens it; band collapse is local (reset
// by remounting on task).
export function FocusColumn({ collapsed, onExpand, onCollapse }: Props) {
  const { selectedTaskId, taskById, snapshot } = useApp()
  const t = useT()
  const language = useLanguage()
  const task = selectedTaskId ? taskById(selectedTaskId) : undefined
  const [bandCollapsed, setBandCollapsed] = useState(false)
  const [bandTab, setBandTab] = useState<'ai' | 'chat'>('ai')

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
  // The chat belongs in the band for the Types whose working area grounds a
  // chat in the task (the document family); the plain notes surface keeps its
  // chat-free treatment until US2 attaches conversations to every task.
  const area = workingAreaFor(meta.family)
  // Chat is an assistant surface: the tab does not exist while the harness
  // is declared off (D1) — no refusal notice, nothing.
  const hasChat = area !== 'notes' && isAssistantEnabled(snapshot!.settings)

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
          <div className={`focus-band ${hasChat && bandTab === 'chat' ? 'chat-open' : ''}`}>
            {hasChat && (
              <div className="band-tabs">
                <button className={`mini-btn ${bandTab === 'ai' ? 'active' : ''}`} onClick={() => setBandTab('ai')}>
                  {t('focus.band.ai')}
                </button>
                <button className={`mini-btn ${bandTab === 'chat' ? 'active' : ''}`} onClick={() => setBandTab('chat')}>
                  {t('focus.band.chat')}
                </button>
              </div>
            )}
            {hasChat && bandTab === 'chat' ? <ChatPanel taskId={task.id} /> : <TaskBand task={task} />}
          </div>
        )}
        <div className={`focus-work ${bandCollapsed ? 'full' : ''}`}>
          {WorkingAreaView[area](task)}
        </div>
      </div>
    </aside>
  )
}
