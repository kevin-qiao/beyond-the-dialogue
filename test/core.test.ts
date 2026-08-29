import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, listLists, createTask, listTasks, updateTask, getTask, loadSettings, saveSettings, deleteList } from '../src/main/db'
import { rolloverMyDay, todayStr, serviceToggleTask, serviceSetMyDay } from '../src/main/tasks'

function freshDB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'))
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

test('2.1 schema applies cleanly on fresh DB with Inbox seeded', () => {
  const { db } = freshDB()
  const lists = listLists(db.db)
  assert.equal(lists.length, 1)
  assert.equal(lists[0]!.name, 'Inbox')
  db.close()
})

test('lists CRUD: create, rename, delete with tasks', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'Research')
  assert.equal(l.name, 'Research')
  const t = createTask(db.db, { listId: l.id, title: 'Read paper', type: 'plain' })
  assert.ok(t.id)
  deleteList(db.db, l.id)
  assert.equal(listTasks(db.db, l.id).length, 0)
  assert.equal(listLists(db.db).some((x) => x.id === l.id), false)
  db.close()
})

test('task CRUD and completion keeps struck-through visibility', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'task' })
  const done = serviceToggleTask(db.db, t.id)
  assert.equal(done.completed, true)
  assert.ok(done.completedAt)
  // still in the list
  assert.ok(listTasks(db.db, l.id).some((x) => x.id === t.id))
  const undone = serviceToggleTask(db.db, t.id)
  assert.equal(undone.completed, false)
  assert.equal(undone.completedAt, null)
  db.close()
})

test('task edit persists everywhere', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'old' })
  const updated = updateTask(db.db, t.id, { title: 'new title', notes: 'note' })
  assert.equal(updated.title, 'new title')
  assert.equal(getTask(db.db, t.id)!.notes, 'note')
  db.close()
})

test('3.1-3.3 My Day membership: add/remove keeps task in original list', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'Work')
  const t = createTask(db.db, { listId: l.id, title: 'x' })
  const inDay = serviceSetMyDay(db.db, t.id, true)
  assert.equal(inDay.inMyDay, true)
  assert.ok(inDay.myDayAddedAt)
  // still in original list
  assert.ok(listTasks(db.db, l.id).some((x) => x.id === t.id))
  const removed = serviceSetMyDay(db.db, t.id, false)
  assert.equal(removed.inMyDay, false)
  assert.equal(removed.myDayAddedAt, null)
  assert.ok(listTasks(db.db, l.id).some((x) => x.id === t.id))
  db.close()
})

test('3.4 rollover clears completed My Day tasks, keeps incomplete', () => {
  const { db } = freshDB()
  // First open establishes today's rollover baseline (app does this at startup).
  rolloverMyDay(db.db, new Date())
  const l = listLists(db.db)[0]!
  const a = createTask(db.db, { listId: l.id, title: 'done' })
  const b = createTask(db.db, { listId: l.id, title: 'open' })
  serviceSetMyDay(db.db, a.id, true)
  serviceSetMyDay(db.db, b.id, true)
  serviceToggleTask(db.db, a.id)
  // same day: nothing cleared
  let res = rolloverMyDay(db.db, new Date())
  assert.equal(res.cleared, 0)
  // next day: completed one cleared, incomplete persists
  const nextDay = new Date(Date.now() + 2 * 86400000)
  res = rolloverMyDay(db.db, nextDay)
  assert.equal(res.cleared, 1)
  const aAfter = getTask(db.db, a.id)!
  const bAfter = getTask(db.db, b.id)!
  assert.equal(aAfter.inMyDay, false)
  assert.equal(bAfter.inMyDay, true)
  db.close()
})

test('3.5 persistence across restart (reopen DB file)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'))
  let db = openDB(dir)
  migrate(db.db)
  const l = createList(db.db, 'Keep')
  const t = createTask(db.db, { listId: l.id, title: 'persist' })
  serviceSetMyDay(db.db, t.id, true)
  serviceToggleTask(db.db, t.id)
  db.close()
  db = openDB(dir)
  const rows = listTasks(db.db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.inMyDay, true)
  assert.equal(rows[0]!.completed, true)
  assert.equal(todayStr(), todayStr())
  db.close()
})

test('2.2 settings persist and stay in DB', () => {
  const { db } = freshDB()
  saveSettings(db.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', wikiPath: '/tmp/wiki', defaultListId: null, maxConcurrentJobs: 2 })
  const s = loadSettings(db.db)
  assert.equal(s.provider, 'openai')
  assert.equal(s.model, 'gpt-4o')
  assert.equal(s.apiKey, 'sk-test')
  db.close()
})

test('paper task creation records link and type', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'paper', type: 'paper_reading', link: 'https://arxiv.org/abs/2301.00001' })
  assert.equal(t.type, 'paper_reading')
  assert.equal(t.link, 'https://arxiv.org/abs/2301.00001')
  assert.equal(t.analysisStatus, 'none')
  db.close()
})
