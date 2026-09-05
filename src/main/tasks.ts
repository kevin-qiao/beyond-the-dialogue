import type { DatabaseSync } from 'node:sqlite'
import {
  createList as dbCreateList,
  deleteList as dbDeleteList,
  deleteTask as dbDeleteTask,
  getTask,
  listLists,
  listTasks,
  mapTask,
  renameList as dbRenameList,
  updateTask as dbUpdateTask,
  createTask as dbCreateTask
} from './db'
import type { List, Task } from '../shared/types'

// Day rollover bookkeeping. The app tracks the last date it performed a
// rollover for; on first open after a date change, completed My Day tasks are
// unflagged (they clear from My Day for the new day) while incomplete tasks
// persist.

const ROLLOVER_KEY = 'last_rollover_date'

export function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function getLastRollover(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ROLLOVER_KEY) as { value: string } | undefined
  return row?.value ?? null
}

export function setLastRollover(db: DatabaseSync, date: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    ROLLOVER_KEY,
    date
  )
}

export function rolloverMyDay(db: DatabaseSync, now = new Date()): { cleared: number } {
  const today = todayStr(now)
  const last = getLastRollover(db)
  if (last === today) return { cleared: 0 }
  // Mark completed My Day tasks as no longer in My Day. Incomplete ones persist.
  const rows = db
    .prepare('SELECT id FROM tasks WHERE in_my_day = 1 AND completed = 1 AND deleted_at IS NULL')
    .all() as { id: string }[]
  const stmt = db.prepare('UPDATE tasks SET in_my_day = 0, my_day_added_at = NULL, updated_at = ? WHERE id = ?')
  const ts = now.toISOString()
  for (const r of rows) stmt.run(ts, r.id)
  setLastRollover(db, today)
  return { cleared: rows.length }
}

// ---- Service functions used by IPC ----

export function serviceCreateList(db: DatabaseSync, name: string): List {
  return dbCreateList(db, name)
}

export function serviceRenameList(db: DatabaseSync, id: string, name: string): List {
  return dbRenameList(db, id, name)
}

export function serviceDeleteList(db: DatabaseSync, id: string): void {
  dbDeleteList(db, id)
}

export function serviceCreateTask(
  db: DatabaseSync,
  data: { listId: string; title: string; notes?: string; type?: Task['type']; customTypeKey?: string | null; inputs?: Record<string, unknown> }
): Task {
  return dbCreateTask(db, data)
}

export function serviceUpdateTask(db: DatabaseSync, id: string, patch: Partial<Task>): Task {
  return dbUpdateTask(db, id, patch)
}

export function serviceDeleteTask(db: DatabaseSync, id: string): void {
  dbDeleteTask(db, id)
}

export function serviceToggleTask(db: DatabaseSync, id: string): Task {
  const t = getTask(db, id)
  if (!t) throw new Error('task not found')
  const now = new Date().toISOString()
  return dbUpdateTask(db, id, {
    completed: !t.completed,
    completedAt: t.completed ? null : now,
    // Completing a task cancels its alarm (spec task-notifications).
    ...(t.completed ? {} : { alarmAt: null })
  })
}

export function serviceSetMyDay(db: DatabaseSync, id: string, inMyDay: boolean): Task {
  const t = getTask(db, id)
  if (!t) throw new Error('task not found')
  const now = new Date().toISOString()
  return dbUpdateTask(db, id, {
    inMyDay,
    myDayAddedAt: inMyDay ? now : null
  })
}

export function serviceListForList(db: DatabaseSync, listId?: string): Task[] {
  return listTasks(db, listId)
}

export function serviceLists(db: DatabaseSync): List[] {
  return listLists(db)
}

export function serviceMyDayTasks(db: DatabaseSync): Task[] {
  const rows = db
    .prepare('SELECT * FROM tasks WHERE deleted_at IS NULL AND in_my_day = 1 ORDER BY my_day_added_at ASC')
    .all()
  return rows.map((r: any) => mapTask(r))
}
