import type { DatabaseSync } from 'node:sqlite'
import { getTask, updateTask } from './db'

// Per-task alarms (design D7): tasks.alarm_at is the single source of truth
// (survives restart, no new storage). This scheduler recomputes the next due
// alarm after any task change, drives one setTimeout, and raises an injected
// notification at the set time. Missed alarms (passed while the app was
// closed) are raised once at start() for not-yet-completed tasks. Electron
// stays out of this module — the notifier is injected — so it's testable
// headless.

export interface AlarmFire {
  taskId: string
  title: string
  /** The alarm's ORIGINAL date-time (ISO), so an overdue raise can name it. */
  dueAt: string
  /** True only for the missed-at-start re-raise (FR-010): the notification
   *  says "overdue" instead of pretending the time has just arrived. */
  overdue: boolean
}

export type Notifier = (fire: AlarmFire) => void

export class AlarmScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private db: DatabaseSync,
    private notify: Notifier,
    private now: () => number = () => Date.now()
  ) {}

  // At startup: raise (once) every alarm whose time passed while closed, then
  // arm the next future alarm. Returns the number of missed alarms raised.
  start(): number {
    this.stopped = false
    let raised = 0
    for (const row of this.pending()) {
      if (new Date(row.alarm_at).getTime() <= this.now()) {
        // Missed while closed: presented once, labeled overdue, with the
        // original due time (FR-010). The task row is not modified beyond the
        // consume-on-fire that already happens.
        this.fire(row.id, { overdue: true, dueAt: row.alarm_at })
        raised++
      }
    }
    this.armNext()
    return raised
  }

  // Call after any task change (set/clear/complete/delete).
  reschedule(): void {
    this.armNext()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private pending(): { id: string; alarm_at: string }[] {
    return this.db
      .prepare(
        'SELECT id, alarm_at FROM tasks WHERE alarm_at IS NOT NULL AND completed = 0 AND deleted_at IS NULL ORDER BY alarm_at ASC'
      )
      .all() as { id: string; alarm_at: string }[]
  }

  private armNext(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.stopped) return
    const now = this.now()
    const next = this.pending().find((r) => new Date(r.alarm_at).getTime() > now)
    if (!next) return
    const delay = Math.max(1, new Date(next.alarm_at).getTime() - now)
    this.timer = setTimeout(() => {
      this.timer = null
      // Re-check due-ness against the clock (timers can drift/coalesce).
      for (const row of this.pending()) {
        if (new Date(row.alarm_at).getTime() <= this.now()) this.fire(row.id, { overdue: false, dueAt: row.alarm_at })
      }
      this.armNext()
    }, delay)
    // Allow the process to exit even while an alarm is armed.
    this.timer.unref?.()
  }

  private fire(taskId: string, meta: { overdue: boolean; dueAt: string }): void {
    const task = getTask(this.db, taskId)
    if (!task || !task.alarmAt || task.completed) return
    // Consume the alarm: it never fires again unless the user re-arms (spec).
    updateTask(this.db, taskId, { alarmAt: null })
    this.notify({ taskId, title: task.title, dueAt: meta.dueAt, overdue: meta.overdue })
  }
}
