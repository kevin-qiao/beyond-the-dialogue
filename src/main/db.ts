import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IngestRecord, JobRecord, List, PaperAnalysis, ReadingNotes, Settings, Suggestion, Task } from '../shared/types'

export interface DB {
  db: DatabaseSync
  path: string
  close: () => void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','paper_reading')),
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  in_my_day INTEGER NOT NULL DEFAULT 0,
  my_day_added_at TEXT,
  link TEXT,
  paper_title TEXT,
  analysis_level TEXT CHECK (analysis_level IN ('full','abstract','metadata')),
  analysis_status TEXT NOT NULL DEFAULT 'none' CHECK (analysis_status IN ('none','queued','running','ready','abstract_only','failed')),
  mismatch_state TEXT NOT NULL DEFAULT 'none' CHECK (mismatch_state IN ('none','warning','confirmed','corrected')),
  analysis_error TEXT,
  pdf_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_mine ON tasks(in_my_day) WHERE deleted_at IS NULL AND in_my_day = 1;

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('analysis','suggestion','ingest')),
  task_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  step_label TEXT,
  progress TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON enrichment_jobs(state);

CREATE TABLE IF NOT EXISTS paper_analysis (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  level TEXT NOT NULL CHECK (level IN ('full','abstract','metadata')),
  status TEXT NOT NULL,
  tldr TEXT NOT NULL DEFAULT '',
  contributions TEXT NOT NULL DEFAULT '[]',
  method TEXT NOT NULL DEFAULT '',
  results TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  suggestions TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_notes (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  note_path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  text TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_task ON suggestions(task_id);

CREATE TABLE IF NOT EXISTS ingest_ledger (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  deposit_files TEXT NOT NULL DEFAULT '[]',
  touched_files TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`

// ---- row mappers ----

function mapTask(r: any): Task {
  return {
    id: r.id,
    listId: r.list_id,
    title: r.title,
    notes: r.notes,
    type: r.type,
    completed: !!r.completed,
    completedAt: r.completed_at,
    inMyDay: !!r.in_my_day,
    myDayAddedAt: r.my_day_added_at,
    link: r.link,
    paperTitle: r.paper_title,
    analysisLevel: r.analysis_level,
    analysisStatus: r.analysis_status,
    mismatchState: r.mismatch_state,
    analysisError: r.analysis_error,
    pdfPath: r.pdf_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

function mapList(r: any): List {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

function mapJob(r: any): JobRecord {
  return {
    id: r.id,
    kind: r.kind,
    taskId: r.task_id,
    state: r.state,
    stepLabel: r.step_label,
    progress: r.progress,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}

function mapAnalysis(r: any): PaperAnalysis {
  return {
    taskId: r.task_id,
    level: r.level,
    status: r.status,
    tldr: r.tldr,
    contributions: JSON.parse(r.contributions),
    method: r.method,
    results: r.results,
    prerequisites: JSON.parse(r.prerequisites),
    suggestions: JSON.parse(r.suggestions),
    updatedAt: r.updated_at
  }
}

function mapNotes(r: any): ReadingNotes {
  return {
    taskId: r.task_id,
    notePath: r.note_path,
    content: r.content,
    updatedAt: r.updated_at
  }
}

function mapSuggestion(r: any): Suggestion {
  return {
    id: r.id,
    taskId: r.task_id,
    text: r.text,
    dismissed: !!r.dismissed,
    createdAt: r.created_at
  }
}

function mapIngest(r: any): IngestRecord {
  return {
    id: r.id,
    taskId: r.task_id,
    taskTitle: r.task_title,
    state: r.state,
    depositFiles: JSON.parse(r.deposit_files),
    touchedFiles: JSON.parse(r.touched_files),
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}

export function openDB(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'app.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  return { db, path: dbPath, close: () => db.close() }
}

export function migrate(db: DatabaseSync): void {
  // Seed a default list on first open.
  const row = db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }
  if (row.n === 0) {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(randomUUID(), 'Inbox', now, now)
  }
}

// ---- Settings ----

const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  model: '',
  apiKey: null,
  wikiPath: '',
  defaultListId: null,
  maxConcurrentJobs: 2
}

export function loadSettings(db: DatabaseSync): Settings {
  const stmt = db.prepare('SELECT key, value FROM settings')
  const rows = stmt.all() as { key: string; value: string }[]
  const out: Settings = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key === 'provider') out.provider = r.value
    else if (r.key === 'model') out.model = r.value
    else if (r.key === 'apiKey') out.apiKey = r.value || null
    else if (r.key === 'wikiPath') out.wikiPath = r.value
    else if (r.key === 'defaultListId') out.defaultListId = r.value || null
    else if (r.key === 'maxConcurrentJobs') out.maxConcurrentJobs = parseInt(r.value, 10) || 2
  }
  return out
}

export function saveSettings(db: DatabaseSync, s: Settings): void {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  upsert.run('provider', s.provider)
  upsert.run('model', s.model)
  upsert.run('apiKey', s.apiKey ?? '')
  upsert.run('wikiPath', s.wikiPath)
  upsert.run('defaultListId', s.defaultListId ?? '')
  upsert.run('maxConcurrentJobs', String(s.maxConcurrentJobs))
}

// ---- Lists ----

export function createList(db: DatabaseSync, name: string): List {
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare('INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
  return mapList(db.prepare('SELECT * FROM lists WHERE id = ?').get(id))
}

export function renameList(db: DatabaseSync, id: string, name: string): List {
  db.prepare('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id)
  return mapList(db.prepare('SELECT * FROM lists WHERE id = ?').get(id))
}

export function deleteList(db: DatabaseSync, id: string): void {
  const now = new Date().toISOString()
  db.prepare('UPDATE lists SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE list_id = ?').run(now, now, id)
}

export function listLists(db: DatabaseSync): List[] {
  const rows = db.prepare('SELECT * FROM lists WHERE deleted_at IS NULL ORDER BY created_at ASC').all()
  return rows.map(mapList)
}

// ---- Tasks ----

export function createTask(
  db: DatabaseSync,
  data: {
    listId: string
    title: string
    notes?: string
    type?: 'plain' | 'paper_reading'
    link?: string
  }
): Task {
  const now = new Date().toISOString()
  const id = randomUUID()
  const type = data.type ?? 'plain'
  db.prepare(
    `INSERT INTO tasks (id, list_id, title, notes, type, in_my_day, analysis_status, mismatch_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'none', 'none', ?, ?)`
  ).run(id, data.listId, data.title, data.notes ?? '', type, now, now)
  if (type === 'paper_reading' && data.link) {
    db.prepare('UPDATE tasks SET link = ? WHERE id = ?').run(data.link, id)
  }
  return getTask(db, id)!
}

export function getTask(db: DatabaseSync, id: string): Task | null {
  const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  return r ? mapTask(r) : null
}

export function listTasks(db: DatabaseSync, listId?: string): Task[] {
  const rows = listId
    ? db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL AND list_id = ? ORDER BY created_at ASC').all(listId)
    : db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY created_at ASC').all()
  return rows.map(mapTask)
}

export function updateTask(db: DatabaseSync, id: string, patch: Partial<Task>): Task {
  const fields: string[] = []
  const values: (string | number | null)[] = []
  const now = new Date().toISOString()
  const fieldMap: Record<string, string> = {
    title: 'title',
    notes: 'notes',
    link: 'link',
    paperTitle: 'paper_title',
    analysisLevel: 'analysis_level',
    analysisStatus: 'analysis_status',
    mismatchState: 'mismatch_state',
    analysisError: 'analysis_error',
    pdfPath: 'pdf_path',
    completed: 'completed',
    completedAt: 'completed_at',
    inMyDay: 'in_my_day',
    myDayAddedAt: 'my_day_added_at'
  }
  for (const [k, v] of Object.entries(patch)) {
    const col = fieldMap[k]
    if (!col) continue
    if (v === undefined) continue
    fields.push(`${col} = ?`)
    if (k === 'completed') values.push(v ? 1 : 0)
    else if (k === 'inMyDay') values.push(v ? 1 : 0)
    else values.push((v as string | number | null) ?? null)
  }
  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTask(db, id)!
}

export function deleteTask(db: DatabaseSync, id: string): void {
  const now = new Date().toISOString()
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

// ---- Jobs ----

export function createJob(db: DatabaseSync, kind: JobRecord['kind'], taskId: string | null): JobRecord {
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare('INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
    id,
    kind,
    taskId,
    'queued',
    now
  )
  return getJob(db, id)!
}

export function getJob(db: DatabaseSync, id: string): JobRecord | null {
  const r = db.prepare('SELECT * FROM enrichment_jobs WHERE id = ?').get(id)
  return r ? mapJob(r) : null
}

export function getJobForTask(db: DatabaseSync, taskId: string, kind: JobRecord['kind']): JobRecord | null {
  const r = db
    .prepare(
      `SELECT * FROM enrichment_jobs WHERE task_id = ? AND kind = ?
       AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`
    )
    .get(taskId, kind)
  return r ? mapJob(r) : null
}

export function updateJob(db: DatabaseSync, id: string, patch: Partial<JobRecord>): JobRecord {
  const fields: string[] = []
  const values: (string | number | null)[] = []
  const fieldMap: Record<string, string> = {
    state: 'state',
    stepLabel: 'step_label',
    progress: 'progress',
    error: 'error',
    attempts: 'attempts',
    startedAt: 'started_at',
    finishedAt: 'finished_at'
  }
  for (const [k, v] of Object.entries(patch)) {
    const col = fieldMap[k]
    if (!col || v === undefined) continue
    fields.push(`${col} = ?`)
    values.push((v as string | number | null) ?? null)
  }
  if (!fields.length) return getJob(db, id)!
  values.push(id)
  db.prepare(`UPDATE enrichment_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getJob(db, id)!
}

export function listRunningJobs(db: DatabaseSync): JobRecord[] {
  const rows = db.prepare("SELECT * FROM enrichment_jobs WHERE state IN ('queued','running') ORDER BY created_at ASC").all()
  return rows.map(mapJob)
}

export function listRecentJobs(db: DatabaseSync, limit = 50): JobRecord[] {
  const rows = db.prepare('SELECT * FROM enrichment_jobs ORDER BY created_at DESC LIMIT ?').all(limit)
  return rows.map(mapJob)
}

// ---- Analysis ----

export function getAnalysis(db: DatabaseSync, taskId: string): PaperAnalysis | null {
  const r = db.prepare('SELECT * FROM paper_analysis WHERE task_id = ?').get(taskId)
  return r ? mapAnalysis(r) : null
}

export function saveAnalysis(db: DatabaseSync, a: Omit<PaperAnalysis, 'updatedAt'>): PaperAnalysis {
  const now = new Date().toISOString()
  const existing = getAnalysis(db, a.taskId)
  if (existing) {
    db.prepare(
      `UPDATE paper_analysis SET level=?, status=?, tldr=?, contributions=?, method=?, results=?, prerequisites=?, suggestions=?, updated_at=? WHERE task_id=?`
    ).run(
      a.level,
      a.status,
      a.tldr,
      JSON.stringify(a.contributions),
      a.method,
      a.results,
      JSON.stringify(a.prerequisites),
      JSON.stringify(a.suggestions),
      now,
      a.taskId
    )
  } else {
    db.prepare(
      `INSERT INTO paper_analysis (task_id, level, status, tldr, contributions, method, results, prerequisites, suggestions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      a.taskId,
      a.level,
      a.status,
      a.tldr,
      JSON.stringify(a.contributions),
      a.method,
      a.results,
      JSON.stringify(a.prerequisites),
      JSON.stringify(a.suggestions),
      now
    )
  }
  return getAnalysis(db, a.taskId)!
}

// ---- Notes ----

export function getNotes(db: DatabaseSync, taskId: string): ReadingNotes | null {
  const r = db.prepare('SELECT * FROM reading_notes WHERE task_id = ?').get(taskId)
  return r ? mapNotes(r) : null
}

export function saveNotes(db: DatabaseSync, n: Omit<ReadingNotes, 'updatedAt'>): ReadingNotes {
  const now = new Date().toISOString()
  const existing = getNotes(db, n.taskId)
  if (existing) {
    db.prepare('UPDATE reading_notes SET content = ?, note_path = ?, updated_at = ? WHERE task_id = ?').run(
      n.content,
      n.notePath,
      now,
      n.taskId
    )
  } else {
    db.prepare('INSERT INTO reading_notes (task_id, note_path, content, updated_at) VALUES (?, ?, ?, ?)').run(
      n.taskId,
      n.notePath,
      n.content,
      now
    )
  }
  return getNotes(db, n.taskId)!
}

// ---- Suggestions ----

export function listSuggestions(db: DatabaseSync, taskId: string): Suggestion[] {
  const rows = db.prepare('SELECT * FROM suggestions WHERE task_id = ? ORDER BY created_at ASC').all(taskId)
  return rows.map(mapSuggestion)
}

export function listAllSuggestions(db: DatabaseSync): Suggestion[] {
  const rows = db.prepare('SELECT * FROM suggestions ORDER BY created_at ASC').all()
  return rows.map(mapSuggestion)
}

export function addSuggestion(db: DatabaseSync, taskId: string, text: string): Suggestion {
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare('INSERT INTO suggestions (id, task_id, text, dismissed, created_at) VALUES (?, ?, ?, 0, ?)').run(id, taskId, text, now)
  return mapSuggestion(db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id))
}

export function dismissSuggestion(db: DatabaseSync, suggestionId: string): Suggestion {
  db.prepare('UPDATE suggestions SET dismissed = 1 WHERE id = ?').run(suggestionId)
  return mapSuggestion(db.prepare('SELECT * FROM suggestions WHERE id = ?').get(suggestionId))
}

// ---- Ingest ledger ----

export function createIngest(db: DatabaseSync, taskId: string, taskTitle: string, depositFiles: string[]): IngestRecord {
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO ingest_ledger (id, task_id, state, deposit_files, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(id, taskId, 'queued', JSON.stringify(depositFiles), now)
  return getIngest(db, id, taskTitle)!
}

export function getIngest(db: DatabaseSync, id: string, taskTitle?: string): IngestRecord | null {
  const r = db.prepare('SELECT * FROM ingest_ledger WHERE id = ?').get(id)
  if (!r) return null
  const row = r as { task_id: string }
  const t = taskTitle ?? (db.prepare('SELECT title FROM tasks WHERE id = ?').get(row.task_id) as { title: string } | undefined)?.title ?? ''
  return { ...mapIngest({ ...r, task_title: t }) }
}

export type IngestPatch = Partial<Omit<IngestRecord, 'taskTitle' | 'depositFiles' | 'touchedFiles'>> & {
  depositFiles?: string[]
  touchedFiles?: string[]
}

export function updateIngest(db: DatabaseSync, id: string, patch: IngestPatch): void {
  const fields: string[] = []
  const values: (string | number | null)[] = []
  const fieldMap: Record<string, string> = {
    state: 'state',
    error: 'error',
    attempts: 'attempts',
    startedAt: 'started_at',
    finishedAt: 'finished_at'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (k === 'depositFiles') {
      fields.push('deposit_files = ?')
      values.push(JSON.stringify(v))
    } else if (k === 'touchedFiles') {
      fields.push('touched_files = ?')
      values.push(JSON.stringify(v))
    } else {
      const col = fieldMap[k]
      if (col) {
        fields.push(`${col} = ?`)
        values.push((v as string | number | null) ?? null)
      }
    }
  }
  if (fields.length) {
    values.push(id)
    db.prepare(`UPDATE ingest_ledger SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }
}

export function listIngest(db: DatabaseSync): IngestRecord[] {
  const rows = db
    .prepare('SELECT i.*, t.title AS task_title FROM ingest_ledger i JOIN tasks t ON t.id = i.task_id ORDER BY i.created_at DESC')
    .all()
  return rows.map(mapIngest)
}

export function listActiveIngest(db: DatabaseSync): IngestRecord[] {
  const rows = db
    .prepare(
      `SELECT i.*, t.title AS task_title FROM ingest_ledger i JOIN tasks t ON t.id = i.task_id
       WHERE i.state IN ('queued','running') ORDER BY i.created_at ASC`
    )
    .all()
  return rows.map(mapIngest)
}
