import { useState } from 'react'
import { useApp } from '../../store'
import { useLanguage, useT } from '../../lib/useT'
import { plural } from '../../../../core/i18n'
import { useDialog } from '../ui/Dialog'
import type { List } from '../../../../shared/types'

// Lists rail — the first column of the board. My Day and To Do are the two
// first-class views; below them the Lists the user owns (feature 001,
// FR-006): create, rename, delete, and browse one List's tasks. The store
// actions (createList/renameList/deleteList) existed with zero call sites
// until this section wired them — the renderer half of D3. Deleting a List
// unassigns its tasks and says so, naming the count before the click.
export function ListsRail() {
  const {
    snapshot,
    activeView,
    setActiveView,
    selectedListId,
    selectList,
    liveJobs,
    activity,
    ingestSteps,
    openDrawer,
    createList,
    renameList,
    deleteList,
    tasksForList
  } = useApp()
  const t = useT()
  const language = useLanguage()
  const { confirm, prompt, dialog } = useDialog()
  const [busy, setBusy] = useState(false)

  // Agent presence line (spec agent-presence): idle / working (with live
  // step) / queued count; clicking opens the Activity drawer.
  const jobs = Object.values(liveJobs)
  const runningJob = jobs.find((j) => j.state === 'running')
  const runningIngest = (activity ?? []).find((r) => r.state === 'running')
  const queuedCount = jobs.filter((j) => j.state === 'queued').length + (activity ?? []).filter((r) => r.state === 'queued').length

  const allTasks = snapshot?.tasks ?? []
  const myDayCount = allTasks.filter((t) => t.inMyDay).length
  const todoCount = allTasks.filter((t) => !t.completed).length
  const lists = snapshot?.lists ?? []

  const addList = async () => {
    const name = await prompt({
      title: t('list.create'),
      message: '',
      confirmLabel: t('common.create'),
      placeholder: t('list.create')
    })
    if (name?.trim()) {
      setBusy(true)
      await createList(name.trim())
      setBusy(false)
    }
  }

  const rename = async (l: List) => {
    const name = await prompt({
      title: t('list.rename'),
      message: '',
      confirmLabel: t('common.save'),
      placeholder: l.name
    })
    if (name?.trim() && name.trim() !== l.name) {
      setBusy(true)
      await renameList(l.id, name.trim())
      setBusy(false)
    }
  }

  const remove = async (l: List) => {
    // FR-006 + the confirmation the spec demands: the count of tasks that
    // become unassigned is named BEFORE the destructive click.
    const count = tasksForList(l.id).length
    const ok = await confirm({
      title: t('list.delete'),
      message: t('list.delete.confirm', { name: l.name, count }),
      confirmLabel: t('common.delete'),
      danger: true
    })
    if (!ok) return
    setBusy(true)
    await deleteList(l.id)
    if (selectedListId === l.id) selectList(null)
    setBusy(false)
  }

  // FR-016/US3-AC5: readiness as three declared states, plain from the board.
  const readiness = snapshot?.aiReadiness ?? 'not-configured'

  return (
    <nav className="sidebar lists-rail">
      <button
        className={`rail-item nav-item ${activeView === 'my-day' ? 'active' : ''}`}
        onClick={() => {
          setActiveView('my-day')
          selectList(null)
        }}
      >
        <span className="rail-ico">☀️</span>
        {t('nav.myDay')}
        <span className="rail-cnt">{myDayCount}</span>
      </button>

      <button
        className={`rail-item nav-item ${activeView === 'todo' && !selectedListId ? 'active' : ''}`}
        onClick={() => {
          setActiveView('todo')
          selectList(null)
        }}
      >
        <span className="rail-ico">📋</span>
        {t('nav.todo')}
        <span className="rail-cnt">{todoCount}</span>
      </button>

      {/* The Lists the user owns (FR-006). A click browses that List; To Do
          remains the all-tasks view where unassigned tasks live. */}
      <div className="rail-section">
        {lists.length > 0 && (
          <div className="rail-section-head">
            <span className="muted">{t('nav.lists.header', { count: lists.length })}</span>
          </div>
        )}
        {lists.map((l) => (
          <div
            key={l.id}
            className={`rail-item list-row ${activeView === 'todo' && selectedListId === l.id ? 'active' : ''}`}
            onClick={() => {
              setActiveView('todo')
              selectList(l.id)
            }}
          >
            <span className="rail-ico">🗂</span>
            <span className="list-name">{l.name}</span>
            <span className="rail-cnt">{tasksForList(l.id).length}</span>
            <button className="icon-btn tiny" title={t('list.rename')} onClick={(e) => { e.stopPropagation(); void rename(l) }}>
              ✎
            </button>
            <button className="icon-btn tiny danger" title={t('list.delete')} onClick={(e) => { e.stopPropagation(); void remove(l) }}>
              🗑
            </button>
          </div>
        ))}
        <button className="mini-btn list-add" disabled={busy} onClick={() => void addList()}>
          ＋ {t('list.create')}
        </button>
      </div>

      <div className="sidebar-foot">
        <div className="ai-status" onClick={() => openDrawer('activity')} title={t('agent.statusHint')}>
          {runningJob ? (
            <span className="ai-working"><span className="presence-dot" />{runningJob.stepLabel ?? t('agent.working')}</span>
          ) : runningIngest ? (
            <span className="ai-working"><span className="presence-dot" />{ingestSteps[runningIngest.id] ?? t('agent.ingesting')}</span>
          ) : queuedCount > 0 ? (
            // A count the language decides how to phrase: English has "job" and
            // "jobs", Chinese has one form.
            <span className="ai-queued">
              <span className="presence-dot" />
              {plural(language, queuedCount, { one: 'queue.queued.one', other: 'queue.queued.other' })}
            </span>
          ) : readiness === 'configured-verified' ? (
            <span className="ai-on"><span className="presence-dot" />{t('agent.ready')}</span>
          ) : readiness === 'configured-last-check-failed' ? (
            <span className="ai-off"><span className="presence-dot" />{t('agent.lastCheckFailed')}</span>
          ) : (
            <span className="ai-off"><span className="presence-dot" />{t('agent.notConfigured')}</span>
          )}
        </div>
      </div>
      {dialog}
    </nav>
  )
}
