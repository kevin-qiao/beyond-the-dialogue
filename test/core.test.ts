import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDB, migrate, createList, listLists, createTask, listTasks, updateTask, getTask, loadSettings, saveSettings, deleteList, createAttachment, getAttachment, listAttachments } from '../src/main/db'
import { rolloverMyDay, todayStr, serviceToggleTask, serviceSetMyDay } from '../src/main/tasks'
import { createTypeDef, effectiveTypeDef, getTypeDef, updateTypeDef, validateInputs } from '../src/main/types'
import { reconcileInputsForType, LEARNING_INPUT_SCHEMA } from '../src/main/db'
import type { TaskTypeDef } from '../src/shared/types'

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

test('lists CRUD: create, rename, delete — deleting a List UNASSIGNS its tasks (FR-006)', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'Research')
  assert.equal(l.name, 'Research')
  const t = createTask(db.db, { listId: l.id, title: 'Read paper', type: 'plain' })
  assert.ok(t.id)
  deleteList(db.db, l.id)
  // The v0.8 behavior was a cascade soft-delete of every task in the List.
  // The clarification retired it: a List delete never destroys work.
  const after = getTask(db.db, t.id)!
  assert.equal(after.deletedAt, null, 'the task survives the delete of its list')
  assert.equal(after.listId, null, 'and is unassigned')
  assert.ok(listTasks(db.db).some((x) => x.id === t.id), 'reachable through the all-tasks query')
  assert.equal(listTasks(db.db, l.id).length, 0, 'the list itself is gone')
  assert.equal(listLists(db.db).some((x) => x.id === l.id), false)

  // Renaming into another List's name is allowed; both stay distinct and are
  // shown as entered (edge case).
  const a = createList(db.db, 'Work')
  const b = createList(db.db, 'Work')
  assert.ok(a.id !== b.id)
  const works = listLists(db.db).filter((x) => x.name === 'Work')
  assert.equal(works.length, 2, 'duplicate names are stored as entered')
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

test('2.2 settings persist and stay in DB — with no secret the Settings table could hold', () => {
  const { db } = freshDB()
  saveSettings(db.db, {
    provider: 'openai', model: 'gpt-4o', hasApiKey: true, defaultListId: null,
    maxConcurrentJobs: 2, showWelcome: false, theme: 'light', uiLanguage: 'en',
    assistantRuntime: 'on', lastCheck: null, skills: [], mcpServers: []
  })
  const s = loadSettings(db.db)
  assert.equal(s.provider, 'openai')
  assert.equal(s.model, 'gpt-4o')
  // v10 (FR-020): the table records PRESENCE only. There is no apiKey field
  // in the Settings shape anymore, and no plaintext row in the table — even
  // a hand-inserted one is deleted on the next save.
  assert.equal(s.hasApiKey, true)
  assert.equal('apiKey' in s, false)
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'apiKey'").get(), undefined)
  db.db.prepare("INSERT INTO settings (key, value) VALUES ('apiKey', 'sk-legacy') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
  saveSettings(db.db, { ...s, model: 'gpt-4o-mini' })
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'apiKey'").get(), undefined)
  // The two new declared settings (T002) round-trip.
  assert.equal(loadSettings(db.db).assistantRuntime, 'on')
  db.close()
})

test('task creation records inputs and type', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'write', type: 'document', inputs: { target: 'Fourier transforms' } })
  assert.equal(t.type, 'document')
  assert.equal(t.inputs.target, 'Fourier transforms')
  assert.equal(t.preprocessStatus, 'none')
  assert.equal(t.alarmAt, null)
  db.close()
})

test('built-in types are seeded and no paper_reading type exists', () => {
  const { db } = freshDB()
  const types = (db.db.prepare('SELECT * FROM task_types ORDER BY sort').all() as any[]).map((r) => r.key)
  // Feature 002 (Q1/Q3, D11): the seeded set is exactly two — `plain` (no
  // family) and one generic write-and-file `document` Type. The learning /
  // jira / meeting built-ins are retired; every further workflow is a
  // user-declared Type on the same machinery.
  assert.deepEqual(types.sort(), ['document', 'plain'])
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
    CREATE TABLE suggestions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE ingest_ledger (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), state TEXT NOT NULL, deposit_files TEXT NOT NULL DEFAULT '[]', touched_files TEXT NOT NULL DEFAULT '[]', error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
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
  // Child rows referencing the tasks table (regression: DROP TABLE tasks used
  // to hit an immediate FK violation with foreign_keys=ON when these exist).
  legacy.prepare('INSERT INTO suggestions (id,task_id,text,dismissed,created_at) VALUES (?,?,?,?,?)').run('s1', 't1', 'read section 2', 0, now)
  legacy.prepare('INSERT INTO ingest_ledger (id,task_id,state,deposit_files,attempts,created_at) VALUES (?,?,?,?,?,?)').run('i1', 't1', 'done', '[]', 1, now)
  legacy.close()

  const db = openDB(dir)
  migrate(db.db)

  const t1 = getTask(db.db, 't1')!
  // The ladder now runs to v15: v3 maps paper_reading → learning, and v13
  // re-homes tasks of the deleted built-in to `plain` — content untouched
  // (FR-017).
  assert.equal(t1.type, 'plain', 'paper_reading row ends re-homed to plain after the full ladder')
  assert.equal(t1.inMyDay, true, 'My Day membership preserved')
  assert.equal(t1.title, 'NFTrig paper', 'title preserved')
  assert.equal(t1.inputs.link, undefined, 'link input removed (v4 migration strips it)')
  assert.equal(t1.preprocessStatus, 'none', 'analysis status does not carry over')
  assert.equal(listTasks(db.db).length, 2)

  // Notes survive under the renamed table.
  const note = db.db.prepare('SELECT * FROM task_notes WHERE task_id = ?').get('t1') as { content: string }
  assert.equal(note.content, '# my paper notes')

  // Custom types moved from the settings blob into the registry — and v13's
  // D11 map gives the learning-kind import the document family.
  const custom = db.db.prepare("SELECT * FROM task_types WHERE key = 'code_review'").get() as any
  assert.ok(custom, 'custom type migrated to task_types')
  assert.equal(custom.family, 'document', 'legacy learning-kind custom types map to the document family (D11)')
  assert.equal(custom.is_builtin, 0)
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'customTypes'").get(), undefined)

  // paper_analysis dropped, stale analysis jobs removed.
  assert.equal(db.db.prepare("SELECT 1 FROM sqlite_master WHERE name='paper_analysis'").get(), undefined)
  assert.equal(db.db.prepare("SELECT 1 FROM enrichment_jobs WHERE kind='analysis'").get(), undefined)

  // FK-bearing child rows survived the tasks rebuild.
  assert.equal((db.db.prepare("SELECT content FROM task_notes WHERE task_id='t1'").get() as { content: string }).content, '# my paper notes')
  assert.ok(db.db.prepare("SELECT 1 FROM suggestions WHERE id='s1' AND task_id='t1'").get(), 'suggestion referencing the old task survived')
  assert.ok(db.db.prepare("SELECT 1 FROM ingest_ledger WHERE id='i1' AND task_id='t1'").get(), 'ingest ledger row survived')
  // And foreign keys still enforce after the rebuild.
  db.db.prepare("PRAGMA foreign_keys = ON").run()
  assert.throws(() => db.db.prepare('INSERT INTO suggestions (id,task_id,text,dismissed,created_at) VALUES (?,?,?,?,?)').run('x1', 'no-such-task', 'x', 0, now))
  db.close()
})

// ---- v5 migration: extensible type workflows ----

// A v4 database: the three tables carrying the behaviour-category CHECK still
// name only the original three categories, and task_types has none of the
// declared-workflow columns. Built by hand rather than by replaying history,
// so it stays a fixed reference as the code moves on.
function legacyV4DB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-v5-'))
  const legacy = new DatabaseSync(path.join(dir, 'app.db'))
  legacy.exec(`
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id), title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','learning','jira')),
      custom_type_key TEXT, inputs TEXT NOT NULL DEFAULT '{}',
      completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
      in_my_day INTEGER NOT NULL DEFAULT 0, my_day_added_at TEXT,
      preprocess_status TEXT NOT NULL DEFAULT 'none' CHECK (preprocess_status IN ('none','queued','running','ready','failed')),
      preprocess_error TEXT, alarm_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE task_types (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira')),
      label TEXT NOT NULL, emoji TEXT NOT NULL, description TEXT, color TEXT,
      input_schema TEXT NOT NULL DEFAULT '[]', ai_guidance TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE task_preprocess (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id),
      kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira')),
      summary TEXT NOT NULL DEFAULT '', analysis TEXT NOT NULL DEFAULT '',
      suggestions_json TEXT NOT NULL DEFAULT '[]', generated_prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'none', inputs_hash TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE enrichment_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('preprocess','suggestion','ingest')), task_id TEXT, state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')), step_label TEXT, progress TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
    CREATE TABLE suggestions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE ingest_ledger (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), state TEXT NOT NULL, deposit_files TEXT NOT NULL DEFAULT '[]', touched_files TEXT NOT NULL DEFAULT '[]', error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (4, '2026-01-01T00:00:00.000Z');
  `)
  const now = new Date().toISOString()
  legacy.prepare('INSERT INTO lists VALUES (?,?,?,?,?)').run('l1', 'Work', now, now, null)
  legacy
    .prepare(`INSERT INTO tasks (id,list_id,title,notes,type,inputs,in_my_day,completed,created_at,updated_at)
              VALUES ('t1','l1','Keep me','note','learning','{"target":"x"}',1,0,?,?)`)
    .run(now, now)
  // A real v4 database carries the learning type's actual schema; the INSERT
  // OR IGNORE seed at the tail of migrate() never overwrites an existing row,
  // so the fixture must supply it or v6 would (correctly) reconcile `target`
  // away against an empty declaration.
  legacy
    .prepare(`INSERT INTO task_types (key,kind,label,emoji,input_schema,is_builtin,sort)
              VALUES ('learning','learning','Learning','🎓',?,1,1)`)
    .run(JSON.stringify(LEARNING_INPUT_SCHEMA))
  legacy
    .prepare(`INSERT INTO task_types (key,kind,label,emoji,input_schema,is_builtin,sort)
              VALUES ('plain','plain','Plain task','📝','[]',1,0)`)
    .run()
  // A child row that must survive the `tasks` rebuild.
  legacy.prepare('INSERT INTO suggestions (id,task_id,text,dismissed,created_at) VALUES (?,?,?,?,?)').run('s1', 't1', 'read section 2', 0, now)
  legacy.close()
  return dir
}

test('a legacy v4 database migrates through the ladder with user data preserved (v5 backfill → v13 vocabulary)', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)

  // The tasks rebuilds (v5, v11, v13) preserved rows and their child
  // references; v13 re-homed the learning task to `plain`, content untouched
  // (FR-017).
  const t1 = getTask(db.db, 't1')!
  assert.equal(t1.title, 'Keep me')
  assert.equal(t1.type, 'plain', 'the deleted built-in re-homes to plain')
  assert.equal(t1.inMyDay, true)
  assert.deepEqual(t1.inputs, { target: 'x' }, 'inputs survive the ladder byte-for-byte')
  assert.ok(db.db.prepare("SELECT 1 FROM suggestions WHERE id='s1' AND task_id='t1'").get(), 'child row survived the rebuilds')

  // The retired built-ins are gone; the seeded set is plain + document.
  assert.equal(db.db.prepare("SELECT 1 FROM task_types WHERE key='learning'").get(), undefined, 'learning built-in deleted (D11)')
  assert.equal(db.db.prepare("SELECT 1 FROM task_types WHERE key='jira'").get(), undefined)
  assert.equal(db.db.prepare("SELECT 1 FROM task_types WHERE key='meeting'").get(), undefined)

  const plain = db.db.prepare("SELECT * FROM task_types WHERE key='plain'").get() as any
  assert.equal(plain.family, null, 'plain keeps no family')
  assert.equal(plain.finish_behaviour, 'complete-only')
  assert.equal(plain.destination_json, null)

  const document = db.db.prepare("SELECT * FROM task_types WHERE key='document'").get() as any
  assert.ok(document, 'the seeded document built-in lands on an existing database')
  assert.equal(document.family, 'document')
  assert.equal(document.is_builtin, 1)
  assert.equal(document.finish_behaviour, 'polish-then-file')
  assert.deepEqual(JSON.parse(document.destination_json), { store: 'folder', rootPath: '', subdir: '' }, 'ships without a location (Q1)')
  // Grants stay the empty default — storage-only (D9).
  assert.deepEqual(JSON.parse(document.grants_json), { skills: [], toolServers: [] })

  db.close()
})

test('v13/v15 drop the retired CHECKs: type keys are free, family mirrors family.ts, history rows survive', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)
  const now = new Date().toISOString()

  // tasks.type is free TEXT: the new built-in key and a user-defined key are
  // both assignable (the research.md reconciliation point, settled).
  db.db
    .prepare(`INSERT INTO tasks (id,list_id,title,notes,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('t2', 'l1', 'Draft', '', 'document', now, now)
  db.db
    .prepare(`INSERT INTO tasks (id,list_id,title,notes,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('t3', 'l1', 'Custom', '', 'code_review', now, now)
  assert.equal(getTask(db.db, 't2')!.type, 'document')
  assert.equal(getTask(db.db, 't3')!.type, 'code_review')

  // task_types.family mirrors the declared set: the three families and NULL
  // are accepted; anything else is rejected.
  db.db
    .prepare(`INSERT INTO task_types (key,family,label,emoji,input_schema,is_builtin,sort,finish_behaviour) VALUES (?,?,?,?,?,0,0,'complete-only')`)
    .run('standup', 'working-system', 'Standup', '📣', '[]')
  db.db
    .prepare(`INSERT INTO task_types (key,family,label,emoji,input_schema,is_builtin,sort,finish_behaviour) VALUES (?,?,?,?,?,0,0,'complete-only')`)
    .run('noassist', null, 'No assist', '🗂', '[]')
  assert.throws(() =>
    db.db
      .prepare(`INSERT INTO task_types (key,family,label,emoji,input_schema,is_builtin,sort,finish_behaviour) VALUES (?,?,?,?,?,0,0,'complete-only')`)
      .run('bad', 'webinar', 'Bad', '❓', '[]')
  )

  // task_preprocess keeps the retired values as history — the CHECK is gone,
  // nothing new writes the table (D4).
  db.db.prepare(`INSERT INTO task_preprocess (task_id,kind,updated_at) VALUES (?,?,?)`).run('t2', 'meeting', now)
  assert.equal((db.db.prepare("SELECT kind FROM task_preprocess WHERE task_id='t2'").get() as any).kind, 'meeting')
  db.close()
})

test('the ladder is idempotent: re-running migrate changes nothing', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)
  const before = db.db.prepare('SELECT key, family, finish_behaviour, destination_json FROM task_types ORDER BY key').all()
  const tasksBefore = listTasks(db.db).length
  migrate(db.db)
  migrate(db.db)
  const after = db.db.prepare('SELECT key, family, finish_behaviour, destination_json FROM task_types ORDER BY key').all()
  assert.deepEqual(after, before)
  assert.equal(listTasks(db.db).length, tasksBefore)
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 13').get() as any).n, 1)
  db.close()
})

test('a fresh database gets the family schema and the two built-ins directly', () => {
  const { db } = freshDB()
  const document = getTypeDefFor(db, 'document')
  assert.equal(document.family, 'document')
  assert.equal(document.finishBehaviour, 'polish-then-file')
  assert.deepEqual(document.destination, { store: 'folder', rootPath: '', subdir: '' })
  const plain = getTypeDefFor(db, 'plain')
  assert.equal(plain.family, null)
  assert.equal(plain.finishBehaviour, 'complete-only')
  // The grants column persists with the empty default — storage-only (D9).
  const grants = db.db.prepare("SELECT grants_json FROM task_types WHERE key='document'").get() as any
  assert.deepEqual(JSON.parse(grants.grants_json), { skills: [], toolServers: [] })
  db.close()
})

function getTypeDefFor(db: DB, key: string): TaskTypeDef {
  const r = db.db.prepare('SELECT * FROM task_types WHERE key = ?').get(key) as any
  return {
    key: r.key,
    family: r.family ?? null,
    label: r.label,
    emoji: r.emoji,
    description: r.description ?? undefined,
    color: r.color ?? undefined,
    inputSchema: JSON.parse(r.input_schema),
    aiGuidance: r.ai_guidance ?? undefined,
    isBuiltin: !!r.is_builtin,
    finishBehaviour: r.finish_behaviour,
    destination: r.destination_json ? JSON.parse(r.destination_json) : undefined
  }
}

// ---- T067: a removed declared field must not strand tasks ----

test('a narrowed type schema clears the now-undeclared inputs from its tasks', () => {
  const { db } = freshDB()
  createTypeDef(db.db, {
    key: 'study',
    family: 'document',
    label: 'Study',
    emoji: '📖',
    inputSchema: [
      { key: 'target', label: 'Target', type: 'text' },
      { key: 'purpose', label: 'Prompt', type: 'textarea' }
    ],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, {
    listId: l.id,
    title: 'keep me',
    type: 'plain',
    customTypeKey: 'study',
    inputs: { target: 'eigenvalues', purpose: 'notes', obsolete: 'stale value' }
  })
  // `obsolete` is stored, but not declared — exactly the state a removed field
  // leaves behind, and `validateInputs` rejects an undeclared key on every
  // write, so the task could not be edited or finished.
  const study = getTypeDef(db.db, 'study')!
  assert.equal(validateInputs(study, t.inputs).ok, false)

  updateTypeDef(db.db, { ...study, label: 'Study' })

  const after = getTask(db.db, t.id)!
  assert.deepEqual(after.inputs, { target: 'eigenvalues', purpose: 'notes' }, 'the declared inputs survived')
  assert.equal(validateInputs(study, after.inputs).ok, true, 'and the task is writable again')
  assert.equal(after.title, 'keep me')
  db.close()
})

test('v6 reconciles a database that was already narrowed before the step existed', () => {
  const { db } = freshDB()
  createTypeDef(db.db, {
    key: 'study',
    family: 'document',
    label: 'Study',
    emoji: '📖',
    inputSchema: [{ key: 'target', label: 'Target', type: 'text' }],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 't', type: 'plain', customTypeKey: 'study', inputs: { target: 'x' } })
  // Simulate the pre-v6 state: a stale key in a task's inputs.
  db.db.prepare('UPDATE tasks SET inputs = ? WHERE id = ?').run(JSON.stringify({ target: 'x', removed_field: 'gone' }), t.id)
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 6').run()

  migrate(db.db)

  assert.deepEqual(getTask(db.db, t.id)!.inputs, { target: 'x' })
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 6').get() as any).n, 1)
  // Idempotent — a second pass changes nothing.
  migrate(db.db)
  assert.deepEqual(getTask(db.db, t.id)!.inputs, { target: 'x' })
  db.close()
})

test('reconciliation respects the effective type of a task using a custom type', () => {
  const { db } = freshDB()
  createTypeDef(db.db, {
    key: 'retro',
    family: 'document',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [{ key: 'target', label: 'Focus', type: 'text' }],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'r', type: 'plain', customTypeKey: 'retro', inputs: { target: 'x', stray: 'y' } })
  // A task resolving through the custom type is checked against THAT schema,
  // not against the built-in type's.
  reconcileInputsForType(db.db, 'retro')
  assert.deepEqual(getTask(db.db, t.id)!.inputs, { target: 'x' })
  db.close()
})

// ---- v7: the per-task skill/MCP placeholders are retired ----

test('v7 strips the retired placeholder inputs from schemas and from tasks', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'L')

  // A custom type still declaring the retired placeholders, as schemas
  // copied from the old built-ins used to.
  createTypeDef(db.db, {
    key: 'study',
    family: 'document',
    label: 'Study',
    emoji: '📖',
    inputSchema: [
      { key: 'target', label: 'Target', type: 'text' },
      { key: 'skill', label: 'Skill', type: 'text', inert: true }
    ],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })

  // Recreate the pre-v7 state: tasks holding values for the retired fields.
  const t = createTask(db.db, { listId: l.id, title: 'x', type: 'plain', customTypeKey: 'study', inputs: { target: 'eigenvalues' } })
  db.db
    .prepare('UPDATE tasks SET inputs = ? WHERE id = ?')
    .run(JSON.stringify({ target: 'eigenvalues', skill: 'summarize', mcp: 'jira-server' }), t.id)

  // A second type that copied the same schema, as creation used to do.
  db.db
    .prepare(
      `INSERT INTO task_types (key, family, label, emoji, input_schema, is_builtin, sort, finish_behaviour, grants_json)
       VALUES ('copied', 'document', 'Copied', '📖', ?, 0, 0, 'complete-only', '{"skills":[],"toolServers":[]}')`
    )
    .run(
      JSON.stringify([
        { key: 'target', label: 'Target', type: 'text' },
        { key: 'skill', label: 'Skill', type: 'select', optionsSource: 'skills', inert: true }
      ])
    )
  const t2 = createTask(db.db, { listId: l.id, title: 'y', type: 'plain', customTypeKey: 'copied', inputs: { target: 'a' } })
  db.db.prepare('UPDATE tasks SET inputs = ? WHERE id = ?').run(JSON.stringify({ target: 'a', skill: 'x' }), t2.id)

  // Re-run the step.
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 7').run()
  migrate(db.db)

  // The schemas no longer declare them...
  const studySchema = JSON.parse((db.db.prepare("SELECT input_schema FROM task_types WHERE key='study'").get() as any).input_schema)
  assert.ok(!studySchema.some((f: any) => f.key === 'skill' || f.key === 'mcp'), 'declared schema stripped')
  const customSchema = JSON.parse((db.db.prepare("SELECT input_schema FROM task_types WHERE key='copied'").get() as any).input_schema)
  assert.ok(!customSchema.some((f: any) => f.key === 'skill'), 'a copied custom schema is stripped too')

  // ...the tasks no longer carry them, and their real inputs survive...
  assert.deepEqual(getTask(db.db, t.id)!.inputs, { target: 'eigenvalues' })
  assert.equal(getTask(db.db, t2.id)!.inputs.skill, undefined)
  assert.equal(getTask(db.db, t2.id)!.inputs.target, 'a')

  // ...and every task is writable again, which is the whole point: an input the
  // type does not declare is rejected by validation on every write.
  for (const task of [getTask(db.db, t.id)!, getTask(db.db, t2.id)!]) {
    const def = effectiveTypeDef(db.db, task)!
    assert.equal(validateInputs(def, task.inputs).ok, true, `${task.title} left unwritable`)
  }

  // Idempotent.
  const before = db.db.prepare('SELECT inputs FROM tasks ORDER BY id').all()
  migrate(db.db)
  assert.deepEqual(db.db.prepare('SELECT inputs FROM tasks ORDER BY id').all(), before)
  db.close()
})

// ---- v8: the wiki location moves from the settings row into the types ----

test('v8 copies a configured wikiPath into every wiki-destined type and drops the setting', () => {
  const { db } = freshDB()
  // Recreate the pre-v8 state: a user who HAD pointed the app at a wiki, and
  // a wiki-destined type with no root of its own (it used to resolve the
  // global setting lazily, at write time). Raw SQL because the current
  // save-time validation refuses an empty root on a user type (FR-013) —
  // this row is history, not something a user can create today.
  db.db
    .prepare(
      `INSERT INTO task_types (key, family, label, emoji, input_schema, is_builtin, sort, finish_behaviour, destination_json, grants_json)
       VALUES ('kb', 'document', 'KB', '📚', '[]', 0, 0, 'deposit-then-curate', ?, '{"skills":[],"toolServers":[]}')`
    )
    .run(JSON.stringify({ store: 'wiki', rootPath: null, subdir: 'learning-notes' }))
  db.db
    .prepare("INSERT INTO settings (key, value) VALUES ('wikiPath', '/home/u/old-wiki') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run()
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
  migrate(db.db)

  const kb = JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='kb'").get() as any).destination_json)
  assert.deepEqual(kb, { store: 'wiki', rootPath: '/home/u/old-wiki', subdir: 'learning-notes' }, 'the configured wiki moved onto the type')
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'wikiPath'").get(), undefined, 'the global setting is gone')

  // Idempotent — a second pass changes nothing.
  migrate(db.db)
  assert.deepEqual(
    JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='kb'").get() as any).destination_json),
    kb
  )
  db.close()
})

test('v8 never materializes the removed default in a database that had not set one', () => {
  const { db } = freshDB()
  db.db
    .prepare(
      `INSERT INTO task_types (key, family, label, emoji, input_schema, is_builtin, sort, finish_behaviour, destination_json, grants_json)
       VALUES ('kb', 'document', 'KB', '📚', '[]', 0, 0, 'deposit-then-curate', ?, '{"skills":[],"toolServers":[]}')`
    )
    .run(JSON.stringify({ store: 'wiki', rootPath: null, subdir: 'learning-notes' }))
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
  migrate(db.db)
  // A database that had been riding on the default is left UNCONFIGURED on
  // purpose: writing ~/Documents/WorkBoard-Wiki into the row would re-create
  // the hidden fallback the migration exists to remove. Finish refuses with a
  // localized code until the type names a directory.
  const kb = JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='kb'").get() as any).destination_json)
  assert.equal(kb.rootPath, null)
  assert.ok(!JSON.stringify(kb).includes('WorkBoard-Wiki'), 'the old default is not resurrected into user data')
  db.close()
})

test('a fresh database ships no inert placeholder inputs at all', () => {
  const { db } = freshDB()
  for (const key of ['document', 'plain']) {
    const def = getTypeDef(db.db, key)!
    assert.ok(
      !def.inputSchema.some((f) => f.key === 'skill' || f.key === 'mcp'),
      `"${key}" still declares a per-task skill/MCP placeholder`
    )
    assert.ok(!def.inputSchema.some((f) => f.inert), `"${key}" declares an inert field`)
  }
  db.close()
})

// ---- feature 001: the migration ladder v10–v12 ----

import { setUserDataRoot } from '../src/main/paths'
import { readSecrets } from '../src/main/secrets'

test('v10 lifts plaintext secrets into the machine-bound store and leaves presence (T008/T009)', () => {
  const { db, dir } = freshDB()
  setUserDataRoot(dir)
  // Recreate the POC state: a plaintext key and an MCP server with env.
  db.db.prepare("INSERT INTO settings (key, value) VALUES ('apiKey', 'sk-plaintext') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
  db.db
    .prepare("INSERT INTO settings (key, value) VALUES ('mcpServers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify([{ name: 'jira', config: { command: 'npx', args: ['-y', 'x'], env: { TOKEN: 't0k3n' } } }]))
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 10').run()
  migrate(db.db)

  // The settings table no longer holds either value.
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'apiKey'").get(), undefined, 'the plaintext row is deleted')
  const row = db.db.prepare("SELECT value FROM settings WHERE key = 'mcpServers'").get() as { value: string }
  assert.ok(!row.value.includes('t0k3n'), 'no env value survives in the row')
  assert.ok(row.value.includes('npx'), 'and the row keeps its shape')
  assert.equal(db.db.prepare("SELECT value FROM settings WHERE key = 'hasApiKey'").get() ? (db.db.prepare("SELECT value FROM settings WHERE key = 'hasApiKey'").get() as any).value : undefined, '1')

  // The store holds them, gated, with the machine fingerprint recorded.
  const { available, secrets } = readSecrets()
  assert.equal(available, true)
  assert.equal(secrets.providerKeys['openai'], 'sk-plaintext')
  assert.deepEqual(secrets.mcpEnv['jira'], { TOKEN: 't0k3n' })

  // Idempotent: a re-run finds no plaintext and changes nothing.
  const before = db.db.prepare('SELECT key, value FROM settings ORDER BY key').all()
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 10').run()
  migrate(db.db)
  assert.deepEqual(db.db.prepare('SELECT key, value FROM settings ORDER BY key').all(), before)

  // loadSettings sees presence, never a value.
  const s = loadSettings(db.db)
  assert.equal(s.hasApiKey, true)
  assert.equal('apiKey' in s, false)
  db.close()
})

test('v11 makes list_id nullable and adds background/target, preserving rows and children (T010/T011)', () => {
  // legacyV4DB: tasks with `list_id TEXT NOT NULL` and no background/target,
  // plus a child suggestions row (the FK trap the v5 precedent documents).
  const dir = legacyV4DB()
  const db = openDB(dir)
  setUserDataRoot(dir)
  migrate(db.db)

  const cols = db.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
  assert.ok(cols.some((c) => c.name === 'background'), 'background column')
  assert.ok(cols.some((c) => c.name === 'target'), 'target column')

  // The pre-existing task survived the rebuild, and a child row did too.
  assert.equal(getTask(db.db, 't1')!.title, 'Keep me')
  assert.ok(db.db.prepare("SELECT 1 FROM suggestions WHERE id='s1' AND task_id='t1'").get(), 'child row survived the rebuild')

  // NULL membership now writes fine, and FK enforcement still holds.
  const now = new Date().toISOString()
  db.db.prepare(`INSERT INTO tasks (id,list_id,title,created_at,updated_at) VALUES ('t9', NULL, 'unassigned', ?, ?)`).run(now, now)
  assert.equal(getTask(db.db, 't9')!.listId, null)
  assert.equal(getTask(db.db, 't9')!.background, '')
  assert.throws(() =>
    db.db.prepare(`INSERT INTO tasks (id,list_id,title,created_at,updated_at) VALUES ('t8', 'no-such-list', 'x', ?, ?)`).run(now, now)
  )

  // Idempotent.
  const before = listTasks(db.db).length
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 11').run()
  migrate(db.db)
  assert.equal(listTasks(db.db).length, before)
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 11').get() as any).n, 1)
  db.close()
})

test('v12 creates the attachment table; rows round-trip and survive an idempotent re-run (T012/T013)', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'with file' })
  const a = createAttachment(db.db, { id: 'xyz', taskId: t.id, name: 'paper.pdf', mime: 'application/pdf', path: 'attachments/xyz/paper.pdf', size: 1234 })
  assert.equal(a.id, 'xyz', 'the id the caller used owns the row and the directory')
  assert.ok(a.id)
  assert.equal(a.taskId, t.id)
  assert.equal(a.size, 1234)
  assert.deepEqual(listAttachments(db.db, t.id).map((x) => x.id), [a.id])

  db.db.prepare('DELETE FROM schema_migrations WHERE version = 12').run()
  migrate(db.db)
  assert.ok(getAttachment(db.db, a.id), 'the row survives an idempotent re-run')
  db.close()
})

// ---- feature 002: the migration ladder v13–v15 (T008, research D11) ----

// A v12-era database: the pre-002 shape at the end of feature 001. Built by
// hand so it stays a fixed reference as the code moves on: `kind` vocabulary,
// the four built-ins, user types of each kind, tasks with real content, and
// history rows in the retired engines' tables.
function legacyV12DB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-v13-'))
  const legacy = new DatabaseSync(path.join(dir, 'app.db'))
  legacy.exec(`
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      list_id TEXT REFERENCES lists(id),
      title TEXT NOT NULL,
      background TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','learning','jira','meeting')),
      custom_type_key TEXT,
      inputs TEXT NOT NULL DEFAULT '{}',
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      in_my_day INTEGER NOT NULL DEFAULT 0,
      my_day_added_at TEXT,
      preprocess_status TEXT NOT NULL DEFAULT 'none' CHECK (preprocess_status IN ('none','queued','running','ready','failed')),
      preprocess_error TEXT,
      alarm_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE task_types (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira','meeting')),
      label TEXT NOT NULL,
      emoji TEXT NOT NULL,
      description TEXT,
      color TEXT,
      input_schema TEXT NOT NULL DEFAULT '[]',
      ai_guidance TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      finish_behaviour TEXT NOT NULL DEFAULT 'complete-only' CHECK (finish_behaviour IN ('complete-only','file-as-is','polish-then-file','deposit-then-curate')),
      destination_json TEXT,
      grants_json TEXT NOT NULL DEFAULT '{"skills":[],"toolServers":[]}'
    );
    CREATE TABLE enrichment_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('preprocess','suggestion','ingest')),
      task_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
      step_label TEXT, progress TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE task_preprocess (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id),
      kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira','meeting')),
      summary TEXT NOT NULL DEFAULT '',
      analysis TEXT NOT NULL DEFAULT '',
      suggestions_json TEXT NOT NULL DEFAULT '[]',
      generated_prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'none',
      inputs_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task_notes (task_id TEXT PRIMARY KEY REFERENCES tasks(id), note_path TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE suggestions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE ingest_ledger (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
      deposit_files TEXT NOT NULL DEFAULT '[]',
      touched_files TEXT NOT NULL DEFAULT '[]',
      error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), name TEXT NOT NULL, mime TEXT, path TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `)
  const now = new Date().toISOString()
  for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(v, now)
  }
  legacy.prepare('INSERT INTO lists VALUES (?,?,?,?,?)').run('l1', 'Work', now, now, null)
  // The four built-ins, as v5+ shipped them.
  const insBuiltin = legacy.prepare(
    `INSERT INTO task_types (key, kind, label, emoji, input_schema, is_builtin, sort, finish_behaviour, destination_json)
     VALUES (?, ?, ?, ?, '[]', 1, ?, ?, ?)`
  )
  insBuiltin.run('plain', 'plain', 'Plain task', '📝', 0, 'complete-only', null)
  insBuiltin.run('learning', 'learning', 'Learning', '🎓', 1, 'deposit-then-curate', JSON.stringify({ store: 'wiki', rootPath: '/home/u/wiki', subdir: 'learning-notes' }))
  insBuiltin.run('jira', 'jira', 'JIRA', '🎫', 2, 'complete-only', null)
  insBuiltin.run('meeting', 'meeting', 'Meeting', '🗓', 3, 'polish-then-file', JSON.stringify({ store: 'folder', rootPath: '/home/u/minutes', subdir: '' }))
  // User-defined types, one per kind — each keeps a declaration v13 must carry.
  const insCustom = legacy.prepare(
    `INSERT INTO task_types (key, kind, label, emoji, input_schema, ai_guidance, is_builtin, sort, finish_behaviour, destination_json)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  )
  insCustom.run('study', 'learning', 'Study', '📖', JSON.stringify([{ key: 'target', label: 'Target', type: 'text' }]), 'Focus.', 10, 'deposit-then-curate', JSON.stringify({ store: 'wiki', rootPath: '/home/u/study-wiki', subdir: 'notes' }))
  insCustom.run('triage', 'jira', 'Triage', '🧭', '[]', null, 11, 'complete-only', null)
  insCustom.run('standup', 'meeting', 'Standup', '📣', '[]', null, 12, 'polish-then-file', JSON.stringify({ store: 'folder', rootPath: '/home/u/standups', subdir: '' }))
  insCustom.run('plainish', 'plain', 'Plainish', '🗒', '[]', null, 13, 'complete-only', null)
  // Tasks of every shape, with real content that must survive byte-identical.
  const insTask = legacy.prepare(
    `INSERT INTO tasks (id, list_id, title, background, target, notes, type, custom_type_key, inputs, in_my_day, preprocess_status, created_at, updated_at)
     VALUES (?, 'l1', ?, ?, ?, ?, ?, ?, ?, 1, 'ready', ?, ?)`
  )
  insTask.run('t-learn', 'Old learning task', 'why it matters', 'the target text', '# my learning note', 'learning', null, JSON.stringify({ target: 'eigenvalues' }), now, now)
  insTask.run('t-jira', 'Old jira task', 'jira bg', 'jira target', 'pasted minutes', 'jira', null, '{}', now, now)
  insTask.run('t-meet', 'Old meeting task', 'meet bg', 'meet target', '## Minutes', 'meeting', null, '{}', now, now)
  insTask.run('t-study', 'Custom study task', 'study bg', 'study target', 'study notes', 'plain', 'study', JSON.stringify({ target: 'x' }), now, now)
  // History rows in the retired engines' tables (D4: they stay).
  legacy.prepare('INSERT INTO task_preprocess (task_id, kind, summary, analysis, suggestions_json, status, inputs_hash, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
    't-learn', 'learning', 'a summary', 'an analysis', '["chip"]', 'ready', 'hash1', now
  )
  legacy.prepare('INSERT INTO suggestions (id, task_id, text, dismissed, created_at) VALUES (?,?,?,?,?)').run('s1', 't-learn', 'read section 2', 0, now)
  legacy.prepare('INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at) VALUES (?,?,?,?,?,?)').run('j-pre', 'preprocess', 't-learn', 'running', 1, now)
  legacy.prepare('INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at) VALUES (?,?,?,?,?,?)').run('j-sug', 'suggestion', 't-jira', 'queued', 0, now)
  legacy.prepare('INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at) VALUES (?,?,?,?,?,?)').run('j-ing', 'ingest', 't-learn', 'done', 1, now)
  legacy.prepare('INSERT INTO ingest_ledger (id, task_id, state, deposit_files, touched_files, attempts, created_at) VALUES (?,?,?,?,?,?,?)').run('i1', 't-learn', 'done', '["note.md"]', '["index.md"]', 1, now)
  legacy.prepare('INSERT INTO task_notes (task_id, note_path, content, updated_at) VALUES (?,?,?,?)').run('t-learn', 'notes/t-learn.md', '# my learning note', now)
  legacy.close()
  return dir
}

test('v13 rebuilds the vocabulary: kind→family per D11, built-ins retired, tasks re-homed, content byte-identical', () => {
  const dir = legacyV12DB()
  const db = openDB(dir)
  migrate(db.db)

  // The family column replaced kind, and the gate fired on the old shape.
  const cols = (db.db.prepare('PRAGMA table_info(task_types)').all() as { name: string }[]).map((c) => c.name)
  assert.ok(cols.includes('family'), 'task_types gained family')
  assert.ok(!cols.includes('kind'), 'kind is gone')

  // Deleted built-ins are gone; the seeded set is plain + document.
  const keys = (db.db.prepare('SELECT key FROM task_types ORDER BY key').all() as { key: string }[]).map((r) => r.key)
  assert.deepEqual(keys, ['document', 'plain', 'plainish', 'standup', 'study', 'triage'])

  // User types mapped by the D11 rule verbatim, declarations kept.
  const study = db.db.prepare("SELECT * FROM task_types WHERE key='study'").get() as any
  assert.equal(study.family, 'document', 'learning → document')
  assert.equal(study.finish_behaviour, 'deposit-then-curate', 'the declared behaviour survives the map')
  assert.deepEqual(JSON.parse(study.destination_json), { store: 'wiki', rootPath: '/home/u/study-wiki', subdir: 'notes' })
  assert.equal(study.ai_guidance, 'Focus.')
  assert.deepEqual(JSON.parse(study.input_schema), [{ key: 'target', label: 'Target', type: 'text' }])
  assert.equal((db.db.prepare("SELECT family FROM task_types WHERE key='triage'").get() as any).family, 'working-system', 'jira → working-system')
  assert.equal((db.db.prepare("SELECT family FROM task_types WHERE key='standup'").get() as any).family, 'document', 'meeting → document')
  assert.equal((db.db.prepare("SELECT family FROM task_types WHERE key='plainish'").get() as any).family, null, 'plain-kind user type stays family-less')

  // Tasks of deleted built-ins re-home to plain, content byte-identical (FR-017).
  const learn = getTask(db.db, 't-learn')!
  assert.equal(learn.type, 'plain')
  assert.equal(learn.background, 'why it matters')
  assert.equal(learn.target, 'the target text')
  assert.equal(learn.notes, '# my learning note')
  assert.deepEqual(learn.inputs, { target: 'eigenvalues' })
  assert.equal(getTask(db.db, 't-jira')!.type, 'plain')
  assert.equal(getTask(db.db, 't-meet')!.type, 'plain')
  // A task resolving through a USER type keeps its reference.
  const studyTask = getTask(db.db, 't-study')!
  assert.equal(studyTask.customTypeKey, 'study')
  assert.equal(studyTask.notes, 'study notes')

  // The seeded document built-in: family document, organize behaviour, and it
  // ships WITHOUT a location (Q1).
  const doc = db.db.prepare("SELECT * FROM task_types WHERE key='document'").get() as any
  assert.equal(doc.family, 'document')
  assert.equal(doc.is_builtin, 1)
  assert.equal(doc.finish_behaviour, 'polish-then-file')
  assert.deepEqual(JSON.parse(doc.destination_json), { store: 'folder', rootPath: '', subdir: '' })

  // The tasks.type CHECK is gone: a user-defined key is assignable (the
  // research.md reconciliation point, settled — T030's guard re-runs it).
  const now = new Date().toISOString()
  db.db.prepare('INSERT INTO tasks (id,list_id,title,type,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('t-custom', 'l1', 'custom key', 'study', now, now)
  assert.equal(getTask(db.db, 't-custom')!.type, 'study')

  // Idempotent: re-running changes nothing.
  const before = db.db.prepare('SELECT key, family, finish_behaviour, destination_json FROM task_types ORDER BY key').all()
  migrate(db.db)
  assert.deepEqual(db.db.prepare('SELECT key, family, finish_behaviour, destination_json FROM task_types ORDER BY key').all(), before)
  db.close()
})

test('v13 does not fire on the new shape: a fresh database keeps its family table', () => {
  const { db } = freshDB()
  const ddl = (db.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_types'").get() as any).sql as string
  assert.ok(ddl.includes('family TEXT'), 'fresh schema is family-shaped from the start')
  assert.ok(!ddl.includes('kind TEXT'))
  db.close()
})

test('v14 creates the conversation tables; rows round-trip and cascade with the task', () => {
  const dir = legacyV12DB()
  const db = openDB(dir)
  migrate(db.db)
  const now = new Date().toISOString()

  // Insert/read round-trip, in insertion order.
  db.db.prepare('INSERT INTO task_conversations (id, task_id, created_at) VALUES (?,?,?)').run('c1', 't-learn', now)
  db.db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, usage_json, created_at) VALUES (?,?,?,?,?,?)").run('m1', 'c1', 'user', 'what is missing?', null, now)
  db.db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, usage_json, created_at) VALUES (?,?,?,?,?,?)").run('m2', 'c1', 'assistant', 'the rollback section', JSON.stringify({ input: 12, output: 7 }), now)
  const msgs = db.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY rowid').all('c1') as any[]
  assert.deepEqual(msgs.map((m) => m.id), ['m1', 'm2'], 'order is insertion order')
  assert.equal(msgs[1].usage_json, JSON.stringify({ input: 12, output: 7 }), 'the assistant message stores its usage metadata')
  // The role CHECK.
  assert.throws(() =>
    db.db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ('m3','c1','tool','x',?)").run(now)
  )
  // The cascade is the storage rule, and deletion is final (001 FR-004). A
  // task of its own: the legacy tables reference tasks WITHOUT cascade, so
  // deleting t-learn (which has history children) would be an FK violation —
  // correct behaviour for the old rows, and not what this asserts.
  db.db.prepare('INSERT INTO tasks (id,list_id,title,type,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('t-conv', 'l1', 'conversed', 'plain', now, now)
  db.db.prepare('INSERT INTO task_conversations (id, task_id, created_at) VALUES (?,?,?)').run('c2', 't-conv', now)
  db.db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)").run('m3', 'c2', 'user', 'hello?', now)
  db.db.prepare('PRAGMA foreign_keys = ON').run()
  db.db.prepare("DELETE FROM tasks WHERE id = 't-conv'").run()
  assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM task_conversations WHERE task_id='t-conv'").get() as any).n, 0, 'deleting the task deletes its conversations')
  assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id='c2'").get() as any).n, 0, 'and their messages')
  // The earlier conversation on t-learn still stands (nothing else removed it).
  assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id='c1'").get() as any).n, 2)
  db.close()
})

test('v15 adds the undo columns, widens the ledger state, and preserves every history row', () => {
  const dir = legacyV12DB()
  const db = openDB(dir)
  migrate(db.db)

  // The ledger gained the undo columns; a done run can move to undone.
  const cols = (db.db.prepare('PRAGMA table_info(ingest_ledger)').all() as { name: string }[]).map((c) => c.name)
  assert.ok(cols.includes('undone_at'))
  assert.ok(cols.includes('snapshot_dir'))
  db.db.prepare("UPDATE ingest_ledger SET state='undone', undone_at=? WHERE id='i1'").run(new Date().toISOString())
  assert.equal((db.db.prepare("SELECT state FROM ingest_ledger WHERE id='i1'").get() as any).state, 'undone')
  // The pre-existing row survived the rebuild with its data.
  const rec = db.db.prepare("SELECT * FROM ingest_ledger WHERE id='i1'").get() as any
  assert.deepEqual(JSON.parse(rec.deposit_files), ['note.md'])
  assert.deepEqual(JSON.parse(rec.touched_files), ['index.md'])

  // The retired category CHECK on task_preprocess is DROPPED, not restated:
  // the history row keeps its retired kind value.
  const pp = db.db.prepare("SELECT * FROM task_preprocess WHERE task_id='t-learn'").get() as any
  assert.equal(pp.kind, 'learning', 'the history row keeps the retired value')
  assert.equal(pp.summary, 'a summary')
  const ppDdl = (db.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_preprocess'").get() as any).sql as string
  assert.ok(!ppDdl.includes('CHECK (kind IN'), 'no category CHECK survives on task_preprocess')

  // The suggestions rows stay (D4).
  assert.ok(db.db.prepare("SELECT 1 FROM suggestions WHERE id='s1'").get())

  // The retired job kinds survive as history — including one stuck in
  // 'running', which nothing may rewrite (T007; test/ai.test.ts pins that
  // requeueInterrupted leaves it alone).
  const jobs = db.db.prepare('SELECT id, kind, state FROM enrichment_jobs ORDER BY id').all() as any[]
  assert.deepEqual(jobs.map((j) => [j.id, j.kind, j.state]), [
    ['j-ing', 'ingest', 'done'],
    ['j-pre', 'preprocess', 'running'],
    ['j-sug', 'suggestion', 'queued']
  ])

  // Idempotent.
  const before = db.db.prepare('SELECT * FROM ingest_ledger').all()
  migrate(db.db)
  assert.deepEqual(db.db.prepare('SELECT * FROM ingest_ledger').all(), before)
  db.close()
})
