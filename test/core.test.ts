import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
  saveSettings(db.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', wikiPath: '/tmp/wiki', defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  const s = loadSettings(db.db)
  assert.equal(s.provider, 'openai')
  assert.equal(s.model, 'gpt-4o')
  assert.equal(s.apiKey, 'sk-test')
  db.close()
})

test('learning task creation records inputs and type', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'learn', type: 'learning', inputs: { target: 'Fourier transforms' } })
  assert.equal(t.type, 'learning')
  assert.equal(t.inputs.target, 'Fourier transforms')
  assert.equal(t.preprocessStatus, 'none')
  assert.equal(t.alarmAt, null)
  db.close()
})

test('v0.8 built-in types are seeded and no paper_reading type exists', () => {
  const { db } = freshDB()
  const types = (db.db.prepare('SELECT * FROM task_types ORDER BY sort').all() as any[]).map((r) => r.key)
  assert.deepEqual(types.sort(), ['jira', 'learning', 'plain'])
  const check = db.db.prepare("SELECT sql FROM sqlite_master WHERE name='tasks'").get() as { sql: string }
  assert.ok(!check.sql.includes('paper_reading'))
  db.close()
})

test('v3 migration: paper rows become learning, notes and core fields preserved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mig-'))
  // Build a legacy (v2) database by hand, then let openDB+migrate upgrade it.
  const legacy = new DatabaseSync(path.join(dir, 'app.db'))
  legacy.exec(`
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, list_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','paper_reading')),
      custom_type_key TEXT, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
      in_my_day INTEGER NOT NULL DEFAULT 0, my_day_added_at TEXT,
      link TEXT, paper_title TEXT,
      analysis_level TEXT, analysis_status TEXT NOT NULL DEFAULT 'none', mismatch_state TEXT NOT NULL DEFAULT 'none',
      analysis_error TEXT, pdf_path TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE enrichment_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('analysis','suggestion','ingest')), task_id TEXT, state TEXT NOT NULL, step_label TEXT, progress TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
    CREATE TABLE paper_analysis (task_id TEXT PRIMARY KEY, level TEXT, status TEXT, tldr TEXT, contributions TEXT, method TEXT, results TEXT, prerequisites TEXT, suggestions TEXT, updated_at TEXT);
    CREATE TABLE reading_notes (task_id TEXT PRIMARY KEY, note_path TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE suggestions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, text TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE ingest_ledger (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, state TEXT NOT NULL, deposit_files TEXT NOT NULL DEFAULT '[]', touched_files TEXT NOT NULL DEFAULT '[]', error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (2, '2026-01-01T00:00:00.000Z');
  `)
  const now = new Date().toISOString()
  legacy.prepare('INSERT INTO lists VALUES (?,?,?,?,?)').run('l1', 'Research', now, now, null)
  legacy
    .prepare(
      `INSERT INTO tasks (id,list_id,title,notes,type,in_my_day,completed,link,paper_title,analysis_status,created_at,updated_at)
       VALUES ('t1','l1','NFTrig paper','note text','paper_reading',1,0,'https://arxiv.org/abs/2301.00001','NFTrig: real title','ready',?,?)`
    )
    .run(now, now)
  legacy.prepare('INSERT INTO tasks (id,list_id,title,notes,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('t2', 'l1', 'plain task', '', 'plain', now, now)
  legacy.prepare("INSERT INTO settings VALUES ('customTypes', ?)").run(JSON.stringify([{ key: 'code_review', label: 'Code review', emoji: '🧐', isCustom: true }]))
  legacy.prepare('INSERT INTO reading_notes VALUES (?,?,?,?)').run('t1', '/tmp/t1.md', '# my paper notes', now)
  legacy.prepare('INSERT INTO enrichment_jobs (id,kind,task_id,state,attempts,created_at) VALUES (?,?,?,?,?,?)').run('j1', 'analysis', 't1', 'done', 1, now)
  legacy.close()

  const db = openDB(dir)
  migrate(db.db)

  const t1 = getTask(db.db, 't1')!
  assert.equal(t1.type, 'learning', 'paper_reading row maps to learning')
  assert.equal(t1.inMyDay, true, 'My Day membership preserved')
  assert.equal(t1.title, 'NFTrig paper', 'title preserved')
  assert.equal(t1.inputs.link, 'https://arxiv.org/abs/2301.00001', 'link folded into inputs')
  assert.equal(t1.preprocessStatus, 'none', 'analysis status does not carry over')
  assert.equal(listTasks(db.db).length, 2)

  // Notes survive under the renamed table.
  const note = db.db.prepare('SELECT * FROM task_notes WHERE task_id = ?').get('t1') as { content: string }
  assert.equal(note.content, '# my paper notes')

  // Custom types moved from the settings blob into the registry.
  const custom = db.db.prepare("SELECT * FROM task_types WHERE key = 'code_review'").get() as any
  assert.ok(custom, 'custom type migrated to task_types')
  assert.equal(custom.kind, 'learning', 'legacy custom types inherit the learning kind')
  assert.equal(custom.is_builtin, 0)
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'customTypes'").get(), undefined)

  // paper_analysis dropped, stale analysis jobs removed.
  assert.equal(db.db.prepare("SELECT 1 FROM sqlite_master WHERE name='paper_analysis'").get(), undefined)
  assert.equal(db.db.prepare("SELECT 1 FROM enrichment_jobs WHERE kind='analysis'").get(), undefined)
  db.close()
})
