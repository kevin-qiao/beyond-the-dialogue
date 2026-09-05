import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  IngestRecord,
  JobRecord,
  List,
  McpServerEntry,
  Settings,
  SkillEntry,
  Suggestion,
  Task,
  TaskKind,
  TaskNote,
  TaskPreprocess,
  TaskTypeDef
} from '../shared/types'

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
  type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','learning','jira')),
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
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_mine ON tasks(in_my_day) WHERE deleted_at IS NULL AND in_my_day = 1;

CREATE TABLE IF NOT EXISTS task_types (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira')),
  label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  description TEXT,
  color TEXT,
  input_schema TEXT NOT NULL DEFAULT '[]',
  ai_guidance TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('preprocess','suggestion','ingest')),
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

CREATE TABLE IF NOT EXISTS task_preprocess (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira')),
  summary TEXT NOT NULL DEFAULT '',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  generated_prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none',
  inputs_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_notes (
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

// ---- built-in type seeds ----

// The canonical definitions of the three built-in types. The migration seeds
// these into task_types (INSERT OR IGNORE so later user edits to
// presentation survive re-migration); custom types of a kind inherit that
// kind's inputSchema unless they declare their own subset.
export const LEARNING_INPUT_SCHEMA: TaskTypeDef['inputSchema'] = [
  { key: 'target', label: 'Target', type: 'text', required: true, placeholder: 'The concept or question to learn' },
  { key: 'link', label: 'Link', type: 'url', placeholder: 'https://… (optional, stored as context)' },
  { key: 'filePath', label: 'File', type: 'file', placeholder: 'Optional attachment kept for the record' },
  { key: 'purpose', label: 'Purpose / Prompt', type: 'textarea', placeholder: 'What you want the note to cover' },
  { key: 'learningNotePath', label: 'Learning-note path', type: 'text', placeholder: 'Defaults inside the wiki' },
  { key: 'skill', label: 'Skill', type: 'select', optionsSource: 'skills', inert: true },
  { key: 'mcp', label: 'MCP server', type: 'select', optionsSource: 'mcpServers', inert: true }
]

export const JIRA_INPUT_SCHEMA: TaskTypeDef['inputSchema'] = [
  {
    key: 'sourceKind',
    label: 'Source kind',
    type: 'select',
    required: true,
    immutable: true,
    options: [
      { value: 'issue', label: 'JIRA issue' },
      { value: 'page', label: 'Confluence page' }
    ]
  },
  { key: 'sourceLink', label: 'Link', type: 'url', placeholder: 'Ticket/page URL (reference only in v0.8)' },
  { key: 'sourceText', label: 'Source content', type: 'textarea', required: true, placeholder: 'Paste the issue/page content' },
  { key: 'target', label: 'Target / Purpose', type: 'textarea', required: true, placeholder: 'What you want done with it' },
  { key: 'comments', label: 'Comment drafts', type: 'textarea', hidden: true, placeholder: 'Draft comments for the issue/page (local only)' },
  { key: 'skill', label: 'Skill', type: 'select', optionsSource: 'skills', inert: true },
  { key: 'mcp', label: 'MCP server', type: 'select', optionsSource: 'mcpServers', inert: true }
]

export function builtinTypeSeeds(): TaskTypeDef[] {
  return [
    {
      key: 'plain',
      kind: 'plain',
      label: 'Plain task',
      emoji: '📝',
      description: 'A plain task — notes and suggestions only, no AI pre-process',
      inputSchema: [],
      isBuiltin: true
    },
    {
      key: 'learning',
      kind: 'learning',
      label: 'Learning',
      emoji: '🎓',
      description: 'Learn a concept: AI prompt + summary, markdown note, Finish ingests to the wiki',
      inputSchema: LEARNING_INPUT_SCHEMA,
      isBuiltin: true
    },
    {
      key: 'jira',
      kind: 'jira',
      label: 'JIRA / Confluence',
      emoji: '🎫',
      description: 'Work an issue or page from pasted content: summaries, chat, comment drafts',
      inputSchema: JIRA_INPUT_SCHEMA,
      isBuiltin: true
    }
  ]
}

// ---- row mappers ----

function parseInputs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function mapTask(r: any): Task {
  return {
    id: r.id,
    listId: r.list_id,
    title: r.title,
    notes: r.notes,
    type: r.type,
    customTypeKey: r.custom_type_key ?? null,
    inputs: parseInputs(r.inputs),
    preprocessStatus: r.preprocess_status ?? 'none',
    preprocessError: r.preprocess_error ?? null,
    alarmAt: r.alarm_at ?? null,
    completed: !!r.completed,
    completedAt: r.completed_at,
    inMyDay: !!r.in_my_day,
    myDayAddedAt: r.my_day_added_at,
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

function mapType(r: any): TaskTypeDef {
  let inputSchema: TaskTypeDef['inputSchema'] = []
  try {
    const parsed = JSON.parse(r.input_schema)
    if (Array.isArray(parsed)) inputSchema = parsed
  } catch {
    // Corrupt schema → treat as no declared inputs rather than crash.
  }
  return {
    key: r.key,
    kind: r.kind,
    label: r.label,
    emoji: r.emoji,
    description: r.description ?? undefined,
    color: r.color ?? undefined,
    inputSchema,
    aiGuidance: r.ai_guidance ?? undefined,
    isBuiltin: !!r.is_builtin
  }
}

function mapPreprocess(r: any): TaskPreprocess {
  let suggestions: string[] = []
  try {
    const parsed = JSON.parse(r.suggestions_json)
    if (Array.isArray(parsed)) suggestions = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    // fall through with empty list
  }
  return {
    taskId: r.task_id,
    kind: r.kind,
    summary: r.summary,
    suggestions,
    generatedPrompt: r.generated_prompt,
    status: r.status,
    inputsHash: r.inputs_hash ?? '',
    updatedAt: r.updated_at
  }
}

function mapNotes(r: any): TaskNote {
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
  // Schema migrations (idempotent, runs once per version per install).
  // Each step checks `schema_migrations` before applying — safe to re-run.
  const ran = (v: number) =>
    !!db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(v)
  const mark = (v: number) =>
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, new Date().toISOString())

  // v1 → v2: custom_type_key column for user-defined task types.
  if (!ran(2)) {
    // SQLite's PRAGMA table_info lets us skip the ALTER if the column already
    // exists (CREATE TABLE IF NOT EXISTS in fresh installs will have it).
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
    if (!cols.some((c) => c.name === 'custom_type_key')) {
      db.exec('ALTER TABLE tasks ADD COLUMN custom_type_key TEXT')
    }
    mark(2)
  }

  // v2 → v3: the type engine (task-type-workflows D1). Rebuilds `tasks`
  // (drops paper columns; adds inputs/alarm_at/preprocess state; maps legacy
  // paper_reading rows to learning with link folded into inputs), swaps the
  // jobs kind CHECK (analysis → preprocess, dropping stale analysis rows),
  // drops paper_analysis, renames reading_notes → task_notes, and moves
  // settings.customTypes into the new task_types table.
  if (!ran(3)) {
    const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'inputs')) {
      // Rebuild tasks (copy rows, drop the paper columns). DROPping a table
      // whose children hold rows fails with foreign_keys=ON, and a crash mid-
      // rebuild can leave a dangling tasks_new — so switch FKs off around the
      // swap and clean up any leftover staging table first.
      db.exec('DROP TABLE IF EXISTS tasks_new')
      db.exec('PRAGMA foreign_keys = OFF;')
      try {
        db.exec(`
          CREATE TABLE tasks_new (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL REFERENCES lists(id),
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain','learning','jira')),
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
          )`)
        const rows = db.prepare('SELECT * FROM tasks').all() as any[]
        const ins = db.prepare(
          `INSERT INTO tasks_new (id, list_id, title, notes, type, custom_type_key, inputs, completed, completed_at,
             in_my_day, my_day_added_at, preprocess_status, preprocess_error, alarm_at, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        for (const r of rows) {
          const type = r.type === 'paper_reading' ? 'learning' : r.type
          const inputs = r.type === 'paper_reading' && r.link ? JSON.stringify({ link: r.link }) : '{}'
          ins.run(
            r.id, r.list_id, r.title, r.notes, type, r.custom_type_key ?? null, inputs,
            r.completed, r.completed_at, r.in_my_day, r.my_day_added_at,
            'none', null, null,
            r.created_at, r.updated_at, r.deleted_at
          )
        }
        db.exec('DROP TABLE tasks')
        db.exec('ALTER TABLE tasks_new RENAME TO tasks')
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id) WHERE deleted_at IS NULL')
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_mine ON tasks(in_my_day) WHERE deleted_at IS NULL AND in_my_day = 1')
      } finally {
        db.exec('PRAGMA foreign_keys = ON;')
      }
    }

    // Jobs table: the old CHECK allowed 'analysis' and not 'preprocess'.
    // Rebuild only when the stored DDL still names 'analysis' (string check
    // on sqlite_master — PRAGMA cannot read CHECK constraints).
    const jobsDdl = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='enrichment_jobs'").get() as { sql: string } | undefined)?.sql ?? ''
    if (jobsDdl.includes("'analysis'")) {
      db.exec(`
        CREATE TABLE enrichment_jobs_new (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('preprocess','suggestion','ingest')),
          task_id TEXT,
          state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
          step_label TEXT,
          progress TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT
        )`)
      db.exec(
        `INSERT INTO enrichment_jobs_new SELECT id, kind, task_id, state, step_label, progress, error, attempts, created_at, started_at, finished_at
         FROM enrichment_jobs WHERE kind != 'analysis'`
      )
      db.exec('DROP TABLE enrichment_jobs')
      db.exec('ALTER TABLE enrichment_jobs_new RENAME TO enrichment_jobs')
      db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_state ON enrichment_jobs(state)')
    }

    db.exec('DROP TABLE IF EXISTS paper_analysis')

    // Rename reading_notes → task_notes. Note: openDB() already created the
    // new-shape task_notes (IF NOT EXISTS), so on legacy DBs the rows must be
    // moved out of reading_notes and the old table dropped.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
    if (tables.includes('reading_notes')) {
      if (tables.includes('task_notes')) {
        db.exec('INSERT OR IGNORE INTO task_notes SELECT task_id, note_path, content, updated_at FROM reading_notes')
        db.exec('DROP TABLE reading_notes')
      } else {
        db.exec('ALTER TABLE reading_notes RENAME TO task_notes')
      }
    }

    // Ensure the new-shape tables exist on legacy DBs (SCHEMA ran before the
    // rebuild above; re-running the IF NOT EXISTS batch is harmless).
    db.exec(SCHEMA)

    // Move user-defined types out of the settings blob.
    const ctRow = db.prepare("SELECT value FROM settings WHERE key = 'customTypes'").get() as { value: string } | undefined
    if (ctRow) {
      try {
        const parsed = JSON.parse(ctRow.value)
        if (Array.isArray(parsed)) {
          const insType = db.prepare(
            `INSERT OR IGNORE INTO task_types (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort)
             VALUES (?, 'learning', ?, ?, ?, ?, ?, NULL, 0, ?)`
          )
          parsed.forEach((c: any, i: number) => {
            if (c && typeof c.key === 'string' && typeof c.label === 'string' && typeof c.emoji === 'string') {
              insType.run(c.key, c.label, c.emoji, c.description ?? null, c.color ?? null, JSON.stringify(LEARNING_INPUT_SCHEMA), 100 + i)
            }
          })
        }
      } catch {
        // Corrupt blob — drop it; built-ins still seed below.
      }
      db.prepare("DELETE FROM settings WHERE key = 'customTypes'").run()
    }
    mark(3)
  }

  // Seed a default list on first open.
  const row = db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }
  if (row.n === 0) {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(randomUUID(), 'Inbox', now, now)
  }

  // Seed the built-in types (create-only: later edits to their presentation
  // survive because this never overwrites existing rows).
  const insType = db.prepare(
    `INSERT OR IGNORE INTO task_types (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 1, ?)`
  )
  builtinTypeSeeds().forEach((t, i) => insType.run(t.key, t.kind, t.label, t.emoji, t.description ?? null, JSON.stringify(t.inputSchema), i))
}

// ---- Settings ----

const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  model: '',
  apiKey: null,
  wikiPath: '',
  defaultListId: null,
  maxConcurrentJobs: 2,
  showWelcome: true,
  theme: 'light',
  skills: [],
  mcpServers: []
}

function parseSkills(value: unknown): SkillEntry[] {
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is SkillEntry => s && typeof s.name === 'string' && typeof s.description === 'string'
    )
  } catch {
    return []
  }
}

function parseMcpServers(value: unknown): McpServerEntry[] {
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is McpServerEntry =>
        s &&
        typeof s.name === 'string' &&
        s.transport &&
        typeof s.transport === 'object' &&
        s.transport.type === 'stdio' &&
        typeof s.transport.command === 'string'
    )
  } catch {
    return []
  }
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
    else if (r.key === 'showWelcome') out.showWelcome = r.value !== '0'
    else if (r.key === 'theme') out.theme = r.value === 'dark' ? 'dark' : 'light'
    else if (r.key === 'skills') out.skills = parseSkills(r.value)
    else if (r.key === 'mcpServers') out.mcpServers = parseMcpServers(r.value)
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
  upsert.run('showWelcome', s.showWelcome ? '1' : '0')
  upsert.run('theme', s.theme === 'dark' ? 'dark' : 'light')
  upsert.run('skills', JSON.stringify(s.skills ?? []))
  upsert.run('mcpServers', JSON.stringify(s.mcpServers ?? []))
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
    type?: Task['type']
    customTypeKey?: string | null
    inputs?: Record<string, unknown>
  }
): Task {
  const now = new Date().toISOString()
  const id = randomUUID()
  const type = data.type ?? 'plain'
  const customTypeKey = data.customTypeKey ?? null
  const inputs = JSON.stringify(data.inputs ?? {})
  db.prepare(
    `INSERT INTO tasks (id, list_id, title, notes, type, custom_type_key, inputs, in_my_day, preprocess_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'none', ?, ?)`
  ).run(id, data.listId, data.title, data.notes ?? '', type, customTypeKey, inputs, now, now)
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
    type: 'type',
    customTypeKey: 'custom_type_key',
    inputs: 'inputs',
    preprocessStatus: 'preprocess_status',
    preprocessError: 'preprocess_error',
    alarmAt: 'alarm_at',
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
    else if (k === 'inputs') values.push(JSON.stringify(v ?? {}))
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

// ---- Task types (registry) ----

export function listTypes(db: DatabaseSync): TaskTypeDef[] {
  const rows = db.prepare('SELECT * FROM task_types ORDER BY is_builtin DESC, sort ASC, key ASC').all()
  return rows.map(mapType)
}

export function getType(db: DatabaseSync, key: string): TaskTypeDef | null {
  const r = db.prepare('SELECT * FROM task_types WHERE key = ?').get(key)
  return r ? mapType(r) : null
}

export function upsertType(db: DatabaseSync, t: TaskTypeDef): TaskTypeDef {
  db.prepare(
    `INSERT INTO task_types (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, label=excluded.label, emoji=excluded.emoji,
       description=excluded.description, color=excluded.color, input_schema=excluded.input_schema,
       ai_guidance=excluded.ai_guidance, is_builtin=excluded.is_builtin, sort=excluded.sort`
  ).run(
    t.key,
    t.kind,
    t.label,
    t.emoji,
    t.description ?? null,
    t.color ?? null,
    JSON.stringify(t.inputSchema ?? []),
    t.aiGuidance ?? null,
    t.isBuiltin ? 1 : 0,
    0
  )
  return getType(db, t.key)!
}

export function deleteType(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM task_types WHERE key = ?').run(key)
}

// Reassign tasks referencing a removed custom type back to `plain`
// (spec: removing a custom type keeps core fields).
export function reassignTasksFromType(db: DatabaseSync, key: string): void {
  const now = new Date().toISOString()
  db.prepare("UPDATE tasks SET type = 'plain', custom_type_key = NULL, inputs = '{}', updated_at = ? WHERE custom_type_key = ?").run(now, key)
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

// ---- Pre-process ----

export function getPreprocess(db: DatabaseSync, taskId: string): TaskPreprocess | null {
  const r = db.prepare('SELECT * FROM task_preprocess WHERE task_id = ?').get(taskId)
  return r ? mapPreprocess(r) : null
}

export function savePreprocess(db: DatabaseSync, p: Omit<TaskPreprocess, 'updatedAt'>): TaskPreprocess {
  const now = new Date().toISOString()
  const existing = getPreprocess(db, p.taskId)
  if (existing) {
    db.prepare(
      `UPDATE task_preprocess SET kind=?, summary=?, suggestions_json=?, generated_prompt=?, status=?, inputs_hash=?, updated_at=? WHERE task_id=?`
    ).run(p.kind, p.summary, JSON.stringify(p.suggestions), p.generatedPrompt, p.status, p.inputsHash ?? '', now, p.taskId)
  } else {
    db.prepare(
      `INSERT INTO task_preprocess (task_id, kind, summary, suggestions_json, generated_prompt, status, inputs_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.taskId, p.kind, p.summary, JSON.stringify(p.suggestions), p.generatedPrompt, p.status, p.inputsHash ?? '', now)
  }
  return getPreprocess(db, p.taskId)!
}

// ---- Notes ----

export function getNotes(db: DatabaseSync, taskId: string): TaskNote | null {
  const r = db.prepare('SELECT * FROM task_notes WHERE task_id = ?').get(taskId)
  return r ? mapNotes(r) : null
}

export function saveNotes(db: DatabaseSync, n: Omit<TaskNote, 'updatedAt'>): TaskNote {
  const now = new Date().toISOString()
  const existing = getNotes(db, n.taskId)
  if (existing) {
    db.prepare('UPDATE task_notes SET content = ?, note_path = ?, updated_at = ? WHERE task_id = ?').run(
      n.content,
      n.notePath,
      now,
      n.taskId
    )
  } else {
    db.prepare('INSERT INTO task_notes (task_id, note_path, content, updated_at) VALUES (?, ?, ?, ?)').run(
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

// Clear a task's suggestion chips before a pre-process re-run regenerates
// them (spec: outputs refresh when relevant inputs change).
export function clearSuggestions(db: DatabaseSync, taskId: string): void {
  db.prepare('DELETE FROM suggestions WHERE task_id = ?').run(taskId)
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
