import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, createTask, getTask, updateTask, deleteTask, type DB } from '../src/main/db'
import { AlarmScheduler, type AlarmFire } from '../src/main/alarms'
import { serviceSetAlarm } from '../src/main/tasks'
import { isLocalizedError } from '../src/core/i18n/issues'

function freshDB(): { db: DB; dir: string; l: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-alarm-'))
  const db = openDB(dir)
  migrate(db.db)
  const l = createList(db.db, 'L')
  return { db, dir, l: l.id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('alarm fires at its time, is consumed, and does not re-fire', async () => {
  const { db, l } = freshDB()
  const fired: AlarmFire[] = []
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f))
  const t = createTask(db.db, { listId: l, title: 'Standup' })
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() + 60).toISOString() })
  sched.start()
  await sleep(250)
  assert.equal(fired.length, 1)
  assert.equal(fired[0]!.title, 'Standup')
  assert.equal(getTask(db.db, t.id)!.alarmAt, null, 'consumed after firing')
  await sleep(250)
  assert.equal(fired.length, 1, 'never fires again')
  sched.stop()
  db.close()
})

test('rescheduling replaces the previous alarm (only the newest is armed)', async () => {
  const { db, l } = freshDB()
  const fired: string[] = []
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f.title))
  const t = createTask(db.db, { listId: l, title: 'Dup' })
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() + 5000).toISOString() })
  sched.reschedule()
  // Replace with a near-future alarm.
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() + 60).toISOString() })
  sched.reschedule()
  await sleep(250)
  assert.deepEqual(fired, ['Dup'])
  sched.stop()
  db.close()
})

test('missed alarms raise exactly once at start', () => {
  const { db, l } = freshDB()
  const fired: string[] = []
  const t = createTask(db.db, { listId: l, title: 'Yesterday' })
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() - 60_000).toISOString() })
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f.title))
  const raised = sched.start()
  assert.equal(raised, 1)
  assert.deepEqual(fired, ['Yesterday'])
  assert.equal(getTask(db.db, t.id)!.alarmAt, null)
  // Second start has nothing missed.
  assert.equal(new AlarmScheduler(db.db, () => {}).start(), 0)
  sched.stop()
  db.close()
})

test('completion cancels a pending alarm; clearing works too', async () => {
  const { db, l } = freshDB()
  const fired: string[] = []
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f.title))
  const t = createTask(db.db, { listId: l, title: 'Done soon' })
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() + 60).toISOString() })
  sched.start()
  // Complete it before it fires.
  updateTask(db.db, t.id, { completed: true, completedAt: new Date().toISOString(), alarmAt: null })
  sched.reschedule()
  await sleep(250)
  assert.deepEqual(fired, [], 'completed tasks never raise')
  const t2 = createTask(db.db, { listId: l, title: 'Cleared' })
  updateTask(db.db, t2.id, { alarmAt: new Date(Date.now() + 60).toISOString() })
  updateTask(db.db, t2.id, { alarmAt: null })
  sched.reschedule()
  await sleep(250)
  assert.deepEqual(fired, [], 'cleared alarm disarms')
  sched.stop()
  db.close()
})

test('alarms survive restart (persisted with the task)', async () => {
  const { db, l, dir } = freshDB()
  const t = createTask(db.db, { listId: l, title: 'Persist' })
  updateTask(db.db, t.id, { alarmAt: new Date(Date.now() + 40).toISOString() })
  db.close()
  const reopened = openDB(dir)
  migrate(reopened.db)
  const fired: string[] = []
  const sched = new AlarmScheduler(reopened.db, (f) => fired.push(f.title))
  assert.ok(getTask(reopened.db, t.id)!.alarmAt, 'alarm survived restart')
  sched.start()
  await sleep(250)
  assert.deepEqual(fired, ['Persist'])
  sched.stop()
  reopened.close()
})

// ---- feature 001 US2: the overdue delta, the past refusal, the clock jump ----

test('a missed alarm re-raises ONCE, labeled overdue with the original due time (FR-010, D5)', () => {
  const { db, l } = freshDB()
  const fired: AlarmFire[] = []
  const t = createTask(db.db, { listId: l, title: 'Review' })
  const due = new Date(Date.now() - 120_000).toISOString()
  updateTask(db.db, t.id, { alarmAt: due })

  const sched = new AlarmScheduler(db.db, (f) => fired.push(f))
  assert.equal(sched.start(), 1)
  assert.equal(fired.length, 1)
  assert.equal(fired[0]!.overdue, true, 'the raise says overdue, not a live reminder')
  assert.equal(fired[0]!.dueAt, due, 'naming the ORIGINAL date-time')
  assert.equal(fired[0]!.title, 'Review')
  assert.equal(getTask(db.db, t.id)!.alarmAt, null, 'consumed — and never re-raised')

  // A second start raises nothing (the "once" half of FR-010).
  assert.equal(sched.start(), 0)
  assert.equal(fired.length, 1, 'no duplicate presentation')
  sched.stop()
  db.close()
})

test('a live (in-session) fire carries NO overdue label', async () => {
  const { db, l } = freshDB()
  const fired: AlarmFire[] = []
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f))
  const t = createTask(db.db, { listId: l, title: 'Soon' })
  const due = new Date(Date.now() + 60).toISOString()
  updateTask(db.db, t.id, { alarmAt: due })
  sched.start()
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(fired.length, 1)
  assert.equal(fired[0]!.overdue, false)
  assert.equal(fired[0]!.dueAt, due)
  sched.stop()
  db.close()
})

test('set-alarm with a past time is refused with a code; change and cancel still work (US2-AC1)', () => {
  const { db, l } = freshDB()
  const t = createTask(db.db, { listId: l, title: 'Alarm me' })
  const now = new Date('2026-06-01T09:00:00.000Z')
  assert.throws(
    () => serviceSetAlarm(db.db, t.id, '2026-06-01T08:59:59.000Z', now),
    (e: unknown) => isLocalizedError(e) && e.issues[0]?.key === 'task.alarm.pastTime'
  )
  assert.equal(getTask(db.db, t.id)!.alarmAt, null, 'the refusal writes nothing')

  // future ⇒ set; change ⇒ newer; null ⇒ cancel.
  serviceSetAlarm(db.db, t.id, '2026-06-02T09:00:00.000Z', now)
  assert.equal(getTask(db.db, t.id)!.alarmAt, '2026-06-02T09:00:00.000Z')
  serviceSetAlarm(db.db, t.id, '2026-06-03T09:00:00.000Z', now)
  assert.equal(getTask(db.db, t.id)!.alarmAt, '2026-06-03T09:00:00.000Z')
  serviceSetAlarm(db.db, t.id, null, now)
  assert.equal(getTask(db.db, t.id)!.alarmAt, null)
  db.close()
})

test('completion AND deletion consume a pending alarm (US2-AC4)', () => {
  const { db, l } = freshDB()
  const fired: AlarmFire[] = []
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f))

  const done = createTask(db.db, { listId: l, title: 'finish me' })
  updateTask(db.db, done.id, { alarmAt: new Date(Date.now() - 1000).toISOString() })
  updateTask(db.db, done.id, { completed: true, completedAt: new Date().toISOString(), alarmAt: null })
  sched.reschedule()

  const gone = createTask(db.db, { listId: l, title: 'delete me' })
  updateTask(db.db, gone.id, { alarmAt: new Date(Date.now() - 1000).toISOString() })
  deleteTask(db.db, gone.id)
  sched.reschedule()

  assert.equal(sched.start(), 0, 'neither a completed nor a deleted task re-raises')
  assert.deepEqual(fired, [])
  sched.stop()
  db.close()
})

test('a backward clock jump never duplicates a presentation (edge case, T036)', async () => {
  const { db, l } = freshDB()
  const fired: AlarmFire[] = []
  // A controllable clock: alarms are due relative to `fakeNow`.
  let fakeNow = Date.now()
  const sched = new AlarmScheduler(db.db, (f) => fired.push(f), () => fakeNow)

  const t = createTask(db.db, { listId: l, title: 'One-shot' })
  updateTask(db.db, t.id, { alarmAt: new Date(fakeNow + 10_000).toISOString() })
  sched.start()
  assert.deepEqual(fired, [], 'nothing is due yet')

  // Jump the clock PAST the due time. A start() now sees it missed exactly
  // the way a clock change during a session does, and raises it once.
  fakeNow += 20_000
  assert.equal(sched.start(), 1, 'the forward jump presents it once')
  assert.equal(fired.length, 1)
  assert.equal(fired[0]!.overdue, true)

  // Jump BACKWARD — the alarm was consumed; it must not come back as "armed
  // in the future" and fire again, and it must not be re-raised.
  fakeNow -= 30_000
  sched.reschedule()
  assert.equal(sched.start(), 0, 'a consumed alarm never returns')
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(fired.length, 1, `at most one presentation per alarm, saw ${fired.length}`)
  sched.stop()
  db.close()
})
