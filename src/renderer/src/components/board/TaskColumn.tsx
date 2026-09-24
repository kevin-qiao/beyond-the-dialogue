import { useMemo, useState } from 'react'
import { useApp } from '../../store'
import type { Task } from '../../../../shared/types'
import { TaskRow } from './TaskRow'
import { QuickAdd } from './QuickAdd'
import { TaskForm } from './TaskForm'
import { TaskContextMenu } from './TaskContextMenu'
import { useDialog } from '../ui/Dialog'
import { useLanguage, useLocale, useT } from '../../lib/useT'
import { IconInbox, IconPlus } from '../ui/icons'
import { allTypeConfigs, displayTypeLabel, typeFilterKey } from '../../lib/typeCatalog'

interface Scope {
  header: string
  dateSub?: string
  rollover?: boolean
  tasks: Task[]
  captureListId: string | null
}

// Task column — the middle column of the board (spec app-layout / task-capture).
// Renders one of three scopes: search results (query active, across all lists),
// My Day (default mode), or the selected list. The header hosts "+ New task"
// and the inline quick-capture; both target the scope's list (default list in
// My Day mode) and are hidden while a search is active.
export function TaskColumn() {
  const { snapshot, activeView, selectedTaskId, selectTask, jobSteps, query, searchTasks, myDayTasks, deleteTask } = useApp()
  const t = useT()
  const language = useLanguage()
  const locale = useLocale()
  const [showNewTask, setShowNewTask] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const { confirm, dialog } = useDialog()

  const handleDelete = async (task: Task) => {
    setCtxMenu(null)
    const ok = await confirm({
      title: t('task.delete.title'),
      message: t('task.delete.message', { title: task.title }),
      confirmLabel: t('common.delete'),
      danger: true
    })
    if (ok) void deleteTask(task.id)
  }

  const lists = snapshot?.lists ?? []
  const defaultListId = snapshot?.settings?.defaultListId ?? lists[0]?.id ?? null
  const q = query.trim()

  let scope: Scope
  if (q) {
    const tasks = searchTasks(snapshot?.tasks ?? [])
    scope = { header: t('nav.search', { count: tasks.length }), tasks, captureListId: null }
  } else if (activeView === 'my-day') {
    const tasks = searchTasks(myDayTasks)
    const today = new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
    scope = {
      header: t('nav.myDay'),
      dateSub: today,
      rollover: true,
      tasks,
      captureListId: defaultListId
    }
  } else {
    // To Do: the backlog — all tasks across lists (open grouped above done).
    const tasks = searchTasks(snapshot?.tasks ?? [])
    scope = { header: t('nav.todo'), tasks, captureListId: defaultListId }
  }

  const open = scope.tasks.filter((t) => !t.completed)
  const done = scope.tasks.filter((t) => t.completed)
  const showCapture = !!scope.captureListId && !q

  // Type filter — derive available types from current scope so chips never show empty.
  // Group key = customTypeKey if set, else the built-in type.
  const typeStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of open) {
      const k = typeFilterKey(t)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [open])

  const filteredOpen = typeFilter ? open.filter((t) => typeFilterKey(t) === typeFilter) : open
  const filteredDone = typeFilter ? done.filter((t) => typeFilterKey(t) === typeFilter) : done

  const completedCount = done.length
  const totalCount = open.length + done.length
  const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  const isMyDay = activeView === 'my-day'

  return (
    <div className="task-column">
      <div className="view-head task-col-head">
        <div className="task-col-title">
          <h2>{scope.header}</h2>
          {scope.dateSub && (
            <span
              className="date-sub"
              title={scope.rollover ? t('nav.rolloverHint') : undefined}
            >
              {scope.dateSub}
            </span>
          )}
          {totalCount > 0 && (
            <div className="col-progress" aria-hidden>
              <div className="bar" style={{ width: `${pct}%` }} />
              <div className="legend">
                <span>
                  <span className="num">{completedCount}</span> {t('nav.progress.done')}
                </span>
                <span>
                  <span className="num">{totalCount}</span> {t('nav.progress.total', { pct })}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="col-header-actions">
          {scope.tasks.length > 0 && !q && <span className="count">{open.length}</span>}
          {scope.captureListId && (
            <button
              className="new-task-btn-col"
              onClick={() => setShowNewTask(true)}
              title={t('nav.newTask')}
            >
              <IconPlus /> {t('nav.newTask')}
            </button>
          )}
        </div>
      </div>

      {showCapture && <QuickAdd listId={scope.captureListId!} onCreated={() => setShowNewTask(false)} />}

      {typeStats.length > 1 && !q && (
        <div className="type-chips">
          <button
            className={`type-chip ${!typeFilter ? 'on' : ''}`}
            onClick={() => setTypeFilter(null)}
            title={t('nav.allTypes')}
          >
            <span className="tc-emoji" aria-hidden>·</span>
            <span className="tc-label">{t('nav.all')}</span>
            <span className="count-mini">{open.length}</span>
          </button>
          {typeStats.map(([ty, n]) => {
            const cfg = allTypeConfigs(snapshot?.taskTypes).find((c) => c.key === ty)
            return (
              <button
                key={ty}
                className={`type-chip ${typeFilter === ty ? 'on' : ''}`}
                onClick={() => setTypeFilter((cur) => (cur === ty ? null : ty))}
                title={t('nav.filterBy', { label: cfg ? displayTypeLabel(cfg, language) : ty })}
              >
                <span className="tc-emoji" aria-hidden>{cfg?.emoji ?? '📌'}</span>
                <span className="tc-label">{cfg ? displayTypeLabel(cfg, language) : ty}</span>
                <span className="count-mini">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {scope.tasks.length === 0 && (
        <div className="empty-hint">
          {q ? t('nav.empty.search') : isMyDay ? t('nav.empty.myDay') : t('nav.empty.todo')}
        </div>
      )}
      <div className="task-list">
        {filteredOpen.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            jobStep={jobSteps[t.id] ?? null}
            selected={t.id === selectedTaskId}
            onSelect={() => selectTask(t.id)}
            onContextMenu={(e, task) => {
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY, task })
            }}
          />
        ))}
        {filteredDone.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            jobStep={jobSteps[t.id] ?? null}
            selected={t.id === selectedTaskId}
            onSelect={() => selectTask(t.id)}
            onContextMenu={(e, task) => {
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY, task })
            }}
          />
        ))}
      </div>

      {showNewTask && scope.captureListId && <TaskForm listId={scope.captureListId} onClose={() => setShowNewTask(false)} />}
      {editingTask && <TaskForm listId={editingTask.listId} task={editingTask} onClose={() => setEditingTask(null)} />}
      {ctxMenu && (
        <TaskContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => {
            setEditingTask(ctxMenu.task)
            setCtxMenu(null)
          }}
          onDelete={() => void handleDelete(ctxMenu.task)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {dialog}
    </div>
  )
}