import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, createTask, getTask, updateTask, type DB } from '../src/main/db'
import { AlarmScheduler, type AlarmFire } from '../src/main/alarms'

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
