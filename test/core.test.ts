import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDB, migrate, createList, listLists, createTask, listTasks, updateTask, getTask, loadSettings, saveSettings, deleteList } from '../src/main/db'
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
  saveSettings(db.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
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

test('built-in types are seeded and no paper_reading type exists', () => {
  const { db } = freshDB()
  const types = (db.db.prepare('SELECT * FROM task_types ORDER BY sort').all() as any[]).map((r) => r.key)
  // SC-002: the built-in set grows from three to four (Meeting is new).
  assert.deepEqual(types.sort(), ['jira', 'learning', 'meeting', 'plain'])
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
  assert.equal(t1.type, 'learning', 'paper_reading row maps to learning')
  assert.equal(t1.inMyDay, true, 'My Day membership preserved')
  assert.equal(t1.title, 'NFTrig paper', 'title preserved')
  assert.equal(t1.inputs.link, undefined, 'link input removed (v4 migration strips it)')
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

test('v5 applies to a legacy database and backfills the learning declaration', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)

  // The tasks rebuild preserved rows and their child references.
  const t1 = getTask(db.db, 't1')!
  assert.equal(t1.title, 'Keep me')
  assert.equal(t1.type, 'learning')
  assert.equal(t1.inMyDay, true)
  assert.deepEqual(t1.inputs, { target: 'x' })
  assert.ok(db.db.prepare("SELECT 1 FROM suggestions WHERE id='s1' AND task_id='t1'").get(), 'child row survived the rebuild')

  // Learning's behaviour is re-expressed as a declaration (FR-003).
  const learning = db.db.prepare("SELECT * FROM task_types WHERE key='learning'").get() as any
  assert.equal(learning.finish_behaviour, 'deposit-then-curate')
  assert.deepEqual(JSON.parse(learning.destination_json), { store: 'wiki', rootPath: null, subdir: 'learning-notes' })
  assert.deepEqual(JSON.parse(learning.grants_json), { skills: [], toolServers: [] })

  // plain finishes locally and writes nothing.
  const plain = db.db.prepare("SELECT * FROM task_types WHERE key='plain'").get() as any
  assert.equal(plain.finish_behaviour, 'complete-only')
  assert.equal(plain.destination_json, null)

  // The Meeting built-in landed with no migration of its own.
  const meeting = db.db.prepare("SELECT * FROM task_types WHERE key='meeting'").get() as any
  assert.ok(meeting, 'Meeting seeded on the next startup of an existing database')
  assert.equal(meeting.kind, 'meeting')
  assert.equal(meeting.finish_behaviour, 'polish-then-file')
  assert.equal(JSON.parse(meeting.destination_json).store, 'folder')

  db.close()
})

test('v5 widens the category CHECK: meeting accepted, unknown values still rejected', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)
  const now = new Date().toISOString()

  // accepted on tasks
  db.db
    .prepare(`INSERT INTO tasks (id,list_id,title,notes,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('t2', 'l1', 'Standup', '', 'meeting', now, now)
  assert.equal(getTask(db.db, 't2')!.type, 'meeting')

  // still rejected
  assert.throws(() =>
    db.db
      .prepare(`INSERT INTO tasks (id,list_id,title,notes,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('t3', 'l1', 'Bad', '', 'paper_reading', now, now)
  )

  // accepted on task_types and task_preprocess
  db.db
    .prepare(`INSERT INTO task_types (key,kind,label,emoji,input_schema,is_builtin,sort) VALUES (?,?,?,?,?,0,0)`)
    .run('standup', 'meeting', 'Standup', '📣', '[]')
  db.db
    .prepare(`INSERT INTO task_preprocess (task_id,kind,updated_at) VALUES (?,?,?)`)
    .run('t2', 'meeting', now)
  assert.equal((db.db.prepare("SELECT kind FROM task_preprocess WHERE task_id='t2'").get() as any).kind, 'meeting')
  assert.throws(() =>
    db.db.prepare(`INSERT INTO task_types (key,kind,label,emoji,input_schema,is_builtin,sort) VALUES (?,?,?,?,?,0,0)`).run('bad', 'webinar', 'Bad', '❓', '[]')
  )
  db.close()
})

test('v5 is idempotent: re-running migrate changes nothing', () => {
  const dir = legacyV4DB()
  const db = openDB(dir)
  migrate(db.db)
  const before = db.db.prepare('SELECT key, kind, finish_behaviour, destination_json FROM task_types ORDER BY key').all()
  const tasksBefore = listTasks(db.db).length
  migrate(db.db)
  migrate(db.db)
  const after = db.db.prepare('SELECT key, kind, finish_behaviour, destination_json FROM task_types ORDER BY key').all()
  assert.deepEqual(after, before)
  assert.equal(listTasks(db.db).length, tasksBefore)
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 5').get() as any).n, 1)
  db.close()
})

test('a fresh database gets the widened schema and the four built-ins directly', () => {
  const { db } = freshDB()
  const learning = getTypeDefFor(db, 'learning')
  assert.equal(learning.finishBehaviour, 'deposit-then-curate')
  assert.deepEqual(learning.destination, { store: 'wiki', rootPath: null, subdir: 'learning-notes' })
  assert.equal(getTypeDefFor(db, 'meeting').finishBehaviour, 'polish-then-file')
  assert.equal(getTypeDefFor(db, 'plain').finishBehaviour, 'complete-only')
  assert.deepEqual(getTypeDefFor(db, 'jira').grants, { skills: [], toolServers: [] })
  db.close()
})

function getTypeDefFor(db: DB, key: string): TaskTypeDef {
  const r = db.db.prepare('SELECT * FROM task_types WHERE key = ?').get(key) as any
  return {
    key: r.key,
    kind: r.kind,
    label: r.label,
    emoji: r.emoji,
    description: r.description ?? undefined,
    color: r.color ?? undefined,
    inputSchema: JSON.parse(r.input_schema),
    aiGuidance: r.ai_guidance ?? undefined,
    isBuiltin: !!r.is_builtin,
    finishBehaviour: r.finish_behaviour,
    destination: r.destination_json ? JSON.parse(r.destination_json) : undefined,
    grants: JSON.parse(r.grants_json)
  }
}

// ---- T067: a removed declared field must not strand tasks ----

test('a narrowed type schema clears the now-undeclared inputs from its tasks', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'L')
  const t = createTask(db.db, {
    listId: l.id,
    title: 'keep me',
    type: 'learning',
    inputs: { target: 'eigenvalues', purpose: 'notes', obsolete: 'stale value' }
  })
  // `obsolete` is stored, but not declared — exactly the state a removed field
  // leaves behind, and `validateInputs` rejects an undeclared key on every
  // write, so the task could not be edited or finished.
  const learning = getTypeDef(db.db, 'learning')!
  assert.equal(validateInputs(learning, t.inputs).ok, false)

  updateTypeDef(db.db, { ...learning, label: 'Learning' })

  const after = getTask(db.db, t.id)!
  assert.deepEqual(after.inputs, { target: 'eigenvalues', purpose: 'notes' }, 'the declared inputs survived')
  assert.equal(validateInputs(learning, after.inputs).ok, true, 'and the task is writable again')
  assert.equal(after.title, 'keep me')
  db.close()
})

test('v6 reconciles a database that was already narrowed before the step existed', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 't', type: 'learning', inputs: { target: 'x' } })
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
    kind: 'meeting',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [{ key: 'target', label: 'Focus', type: 'text' }],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    grants: { skills: [], toolServers: [] }
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'r', type: 'meeting', customTypeKey: 'retro', inputs: { target: 'x', stray: 'y' } })
  // A task resolving through the custom type is checked against THAT schema,
  // not against the built-in meeting type's.
  reconcileInputsForType(db.db, 'retro')
  assert.deepEqual(getTask(db.db, t.id)!.inputs, { target: 'x' })
  db.close()
})

// ---- v7: the per-task skill/MCP placeholders are retired ----

test('v7 strips the retired placeholder inputs from schemas and from tasks', () => {
  const { db } = freshDB()
  const l = createList(db.db, 'L')

  // Recreate the pre-v7 state: a task holding values for the retired fields.
  const t = createTask(db.db, { listId: l.id, title: 'x', type: 'learning', inputs: { target: 'eigenvalues' } })
  db.db
    .prepare('UPDATE tasks SET inputs = ? WHERE id = ?')
    .run(JSON.stringify({ target: 'eigenvalues', skill: 'summarize', mcp: 'jira-server' }), t.id)

  // A custom type that copied the built-in schema, as creation used to do.
  db.db
    .prepare(
      `INSERT INTO task_types (key, kind, label, emoji, input_schema, is_builtin, sort, finish_behaviour, grants_json)
       VALUES ('copied', 'learning', 'Copied', '🎓', ?, 0, 0, 'complete-only', '{"skills":[],"toolServers":[]}')`
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
  const builtinSchema = JSON.parse((db.db.prepare("SELECT input_schema FROM task_types WHERE key='learning'").get() as any).input_schema)
  assert.ok(!builtinSchema.some((f: any) => f.key === 'skill' || f.key === 'mcp'), 'built-in schema stripped')
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
  // Recreate the pre-v8 state: a user who HAD pointed the app at a wiki. The
  // seeded wiki destinations carry no root because they used to resolve the
  // global setting lazily, at write time.
  db.db
    .prepare("INSERT INTO settings (key, value) VALUES ('wikiPath', '/home/u/old-wiki') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run()
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
  migrate(db.db)

  const learning = JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='learning'").get() as any).destination_json)
  assert.deepEqual(learning, { store: 'wiki', rootPath: '/home/u/old-wiki', subdir: 'learning-notes' }, 'the configured wiki moved onto the type')
  assert.equal(db.db.prepare("SELECT 1 FROM settings WHERE key = 'wikiPath'").get(), undefined, 'the global setting is gone')

  // Idempotent — a second pass changes nothing.
  migrate(db.db)
  assert.deepEqual(
    JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='learning'").get() as any).destination_json),
    learning
  )
  db.close()
})

test('v8 never materializes the removed default in a database that had not set one', () => {
  const { db } = freshDB()
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
  migrate(db.db)
  // A database that had been riding on the default is left UNCONFIGURED on
  // purpose: writing ~/Documents/WorkBoard-Wiki into the row would re-create
  // the hidden fallback the migration exists to remove. Finish refuses with
  // `wiki.notConfigured` until the type names a directory.
  const learning = JSON.parse((db.db.prepare("SELECT destination_json FROM task_types WHERE key='learning'").get() as any).destination_json)
  assert.equal(learning.rootPath, null)
  assert.ok(!JSON.stringify(learning).includes('WorkBoard-Wiki'), 'the old default is not resurrected into user data')
  db.close()
})

test('a fresh database ships no inert placeholder inputs at all', () => {
  const { db } = freshDB()
  for (const key of ['learning', 'jira', 'meeting', 'plain']) {
    const def = getTypeDef(db.db, key)!
    assert.ok(
      !def.inputSchema.some((f) => f.key === 'skill' || f.key === 'mcp'),
      `"${key}" still declares a per-task skill/MCP placeholder`
    )
    // Nothing shipped is inert either: grants are per type, and the mechanism
    // is retained without a user (see src/shared/types.ts).
    assert.ok(!def.inputSchema.some((f) => f.inert), `"${key}" declares an inert field`)
  }
  db.close()
})
