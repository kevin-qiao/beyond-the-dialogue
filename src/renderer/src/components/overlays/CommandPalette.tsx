import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { Task, TaskTypeDef } from '../../../../shared/types'
import type { Language, Translate } from '../../../../core/i18n'
import { allTypeConfigs, displayTypeLabel, typeEmoji, typeLabel } from '../../lib/typeCatalog'
import { useLanguage } from '../../lib/useT'

// CommandPalette (⌘K) — spec app-layout v2: a global palette that fuses quick
// actions, task jumping, and type filtering into one keyboard-first surface.
// It opens on Ctrl/Cmd+K, supports fuzzy substring matching across the three
// sections, and supports ↑/↓/Enter navigation. Esc or clicking the backdrop
// closes it. The store never knows it exists — open/close is App-local so a
// stale context never leaves the palette stuck on screen.

type ActionItem = {
  kind: 'action'
  id: string
  title: string
  sub: string
  ico: string
  kbd?: string
  run: () => void
}
type TaskItem = {
  kind: 'task'
  id: string
  title: string
  sub: string
  ico: string
  run: () => void
}
type TypeItem = {
  kind: 'type'
  id: string
  title: string
  sub: string
  ico: string
  run: () => void
}
type PaletteItem = ActionItem | TaskItem | TypeItem

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot, setActiveView, selectTask, openDrawer, saveSettings, notify } = useApp()
  const t = useT()
  const language = useLanguage()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset state every time we open — the palette is a stateless modal surface.
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      // Defer focus so the overlay's show transition has time to apply.
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(timer)
    }
  }, [open])

  // Build items fresh on every render so we always reflect the current snapshot
  // (tasks created mid-session, settings changed, etc.).
  const items: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = []
    const theme = snapshot?.settings.theme ?? 'light'

    // -- Actions --
    out.push({
      kind: 'action',
      id: 'new-task',
      title: t('nav.newTask'),
      sub: t('palette.action.newTask.sub'),
      ico: '✚',
      kbd: 'N',
      run: () => {
        const el = document.getElementById('quick-add')
        const input = el?.querySelector('input') ?? el
        ;(input as HTMLElement | null)?.focus()
      }
    })
    out.push({
      kind: 'action',
      id: 'open-settings',
      title: t('palette.action.settings'),
      sub: t('palette.action.settings.sub'),
      ico: '⚙',
      kbd: '⌘,',
      run: () => openDrawer('settings')
    })
    out.push({
      kind: 'action',
      id: 'open-activity',
      title: t('palette.action.activity'),
      sub: t('palette.action.activity.sub'),
      ico: '▤',
      run: () => openDrawer('activity')
    })
    out.push({
      kind: 'action',
      id: 'open-chat',
      title: t('palette.action.chat'),
      sub: t('palette.action.chat.sub'),
      ico: '💬',
      run: () => openDrawer('chat')
    })
    out.push({
      kind: 'action',
      id: 'go-today',
      title: t('palette.action.today'),
      sub: t('palette.action.today.sub'),
      ico: '☀',
      kbd: '⌘1',
      run: () => setActiveView('my-day')
    })
    const toDark = theme === 'light'
    out.push({
      kind: 'action',
      id: 'toggle-theme',
      title: t('palette.action.theme'),
      sub: t(toDark ? 'palette.action.theme.toDark' : 'palette.action.theme.toLight'),
      ico: toDark ? '☾' : '☀',
      run: () => {
        if (!snapshot) return
        void saveSettings({ ...snapshot.settings, theme: toDark ? 'dark' : 'light' })
        notify(t('palette.theme.notified', { theme: t(toDark ? 'palette.theme.dark' : 'palette.theme.light') }))
      }
    })

    // -- Tasks (live snapshot, completed last so open tasks float up) --
    if (snapshot) {
      const open = snapshot.tasks.filter((task) => !task.completed && !task.deletedAt).slice(0, 50)
      const done = snapshot.tasks.filter((task) => task.completed && !task.deletedAt).slice(0, 20)
      for (const task of [...open, ...done]) {
        out.push(taskToItem(t, language, task, snapshot.lists, selectTask, snapshot.taskTypes))
      }
    }

    // -- Types (built-in + custom from settings) --
    for (const c of allTypeConfigs(snapshot?.taskTypes)) {
      out.push({
        kind: 'type',
        id: 'type-' + c.key,
        title: displayTypeLabel(c, language),
        sub: `${c.key} · ${t(c.isBuiltin ? 'palette.type.builtin' : 'palette.type.custom')}`,
        ico: c.emoji,
        run: () => {
          notify(
            t(c.isBuiltin ? 'palette.type.notifyBuiltin' : 'palette.type.notifyCustom', {
              label: displayTypeLabel(c, language)
            })
          )
        }
      })
    }

    return out
  }, [snapshot, setActiveView, openDrawer, saveSettings, selectTask, notify, t, language])

  // Filter — empty query shows the curated top set; otherwise substring match.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) {
      // Surface: first 5 actions + first 6 tasks + all types
      const acts = items.filter((i) => i.kind === 'action').slice(0, 5)
      const tasks_ = items.filter((i) => i.kind === 'task').slice(0, 6)
      const types_ = items.filter((i) => i.kind === 'type')
      return [...acts, ...tasks_, ...types_]
    }
    return items.filter((i) => {
      return i.title.toLowerCase().includes(needle) || i.sub.toLowerCase().includes(needle)
    })
  }, [items, q])

  // Reset selection when filter changes so Enter never fires a stale index.
  useEffect(() => {
    setSel(0)
  }, [q])

  // Auto-scroll the highlighted item into view as the user arrows through.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const el = root.querySelector('.cmd-item.sel') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, filtered])

  function runItem(it: PaletteItem) {
    onClose()
    // Defer run() so the close animation doesn't compete with focus shifts.
    window.setTimeout(it.run, 0)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = filtered[sel]
      if (it) runItem(it)
    }
  }

  if (!open) return null

  // Group filtered items by kind for the section labels.
  const groups: { label: string; items: PaletteItem[] }[] = []
  const pushGroup = (label: string, k: PaletteItem['kind']) => {
    const sub = filtered.filter((i) => i.kind === k)
    if (sub.length) groups.push({ label, items: sub })
  }
  pushGroup(t('palette.group.actions'), 'action')
  pushGroup(t('palette.group.tasks'), 'task')
  pushGroup(t('palette.group.types'), 'type')

  return (
    <div className={`cmd-overlay ${open ? 'show' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmd-palette" role="dialog" aria-modal="true" aria-label={t('palette.ariaLabel')}>
        <div className="cmd-input">
          <span className="cmd-ico-search" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className="cmd-search-input"
            placeholder={t('palette.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="cmd-kbd-hint">esc</span>
        </div>
        <div className="cmd-results" ref={listRef}>
          {groups.length === 0 && <div className="cmd-empty">{t('palette.empty', { q })}</div>}
          {(() => {
            // Flatten with a running idx so .sel matches filtered[] not the slice.
            let running = 0
            return groups.map((g) => (
              <div key={g.label} className="cmd-group">
                <div className="cmd-section">{g.label}</div>
                {g.items.map((it) => {
                  const idx = running++
                  return (
                    <div
                      key={it.id}
                      className={`cmd-item ${idx === sel ? 'sel' : ''}`}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => runItem(it)}
                    >
                      <div className="cmd-ico">{it.ico}</div>
                      <div className="cmd-main">
                        <div className="cmd-title">{it.title}</div>
                        <div className="cmd-sub">{it.sub}</div>
                      </div>
                      {it.kind === 'action' && it.kbd ? <span className="cmd-kbd">{it.kbd}</span> : null}
                    </div>
                  )
                })}
              </div>
            ))
          })()}
        </div>
      </div>
    </div>
  )
}

function taskToItem(
  t: Translate,
  language: Language,
  task: Task,
  lists: { id: string; name: string }[],
  selectTask: (id: string | null) => void,
  types?: TaskTypeDef[] | null
): TaskItem {
  const list = lists.find((l) => l.id === task.listId)
  const label = typeLabel(task, types, language)
  const ico = typeEmoji(task, types)
  return {
    kind: 'task',
    id: 'task-' + task.id,
    title: task.title || t('palette.untitled'),
    sub: `${label}${list ? ' · ' + list.name : ''}${task.completed ? ' · ✓' : ''}`,
    ico,
    run: () => selectTask(task.id)
  }
}
