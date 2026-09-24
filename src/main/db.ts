import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Destination,
  FinishBehaviour,
  IngestRecord,
  JobRecord,
  List,
  McpServerEntry,
  PluginGrant,
  Settings,
  SkillEntry,
  Suggestion,
  Task,
  TaskKind,
  TaskNote,
  TaskPreprocess,
  TaskTypeDef
} from '../shared/types'
import { NO_GRANT } from '../shared/types'
import { DEFAULT_LANGUAGE, isLanguage } from '../core/i18n/language'
import { en } from '../core/i18n/en'
import { dbPathIn, defaultMeetingMinutesPath, userDataDir } from './paths'

export interface DB {
  db: DatabaseSync
  path: string
  close: () => void
}

// NOTE ON THE CHECK CONSTRAINTS BELOW — constitution Principle VI.
// SQL cannot reference a TypeScript constant, so the category and finish-
// behaviour vocabularies are necessarily restated here as literals. That is
// the unavoidable-hardcoding case: each restatement names its source so it
// cannot drift unnoticed. The declaration they mirror is
// src/core/domain/categories.ts (CATEGORIES and FINISH_BEHAVIOURS). When that
// file changes, these change with it.
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
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_mine ON tasks(in_my_day) WHERE deleted_at IS NULL AND in_my_day = 1;

CREATE TABLE IF NOT EXISTS task_types (
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
  kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira','meeting')),
  summary TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '',
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
//
// The human-readable strings come from the English catalog rather than being
// written here. One home for each string, and — because a stored label is
// recognised as still-default by comparing it against that catalog — the
// comparison cannot drift from what was actually seeded.
export const LEARNING_INPUT_SCHEMA: TaskTypeDef['inputSchema'] = [
  {
    key: 'target',
    label: en['type.learning.field.target.label'],
    type: 'text',
    required: true,
    placeholder: en['type.learning.field.target.placeholder']
  },
  {
    key: 'filePath',
    label: en['type.learning.field.filePath.label'],
    type: 'file',
    placeholder: en['type.learning.field.filePath.placeholder']
  },
  {
    key: 'purpose',
    label: en['type.learning.field.purpose.label'],
    type: 'textarea',
    placeholder: en['type.learning.field.purpose.placeholder']
  },
  {
    key: 'learningNotePath',
    label: en['type.learning.field.learningNotePath.label'],
    type: 'text',
    placeholder: en['type.learning.field.learningNotePath.placeholder']
  }
]

export const JIRA_INPUT_SCHEMA: TaskTypeDef['inputSchema'] = [
  {
    key: 'sourceKind',
    label: en['type.jira.field.sourceKind.label'],
    type: 'select',
    required: true,
    immutable: true,
    options: [
      { value: 'issue', label: en['type.jira.field.sourceKind.option.issue'] },
      { value: 'page', label: en['type.jira.field.sourceKind.option.page'] }
    ]
  },
  {
    key: 'sourceLink',
    label: en['type.jira.field.sourceLink.label'],
    type: 'url',
    placeholder: en['type.jira.field.sourceLink.placeholder']
  },
  {
    key: 'sourceText',
    label: en['type.jira.field.sourceText.label'],
    type: 'textarea',
    required: true,
    placeholder: en['type.jira.field.sourceText.placeholder']
  },
  {
    key: 'target',
    label: en['type.jira.field.target.label'],
    type: 'textarea',
    required: true,
    placeholder: en['type.jira.field.target.placeholder']
  },
  {
    key: 'comments',
    label: en['type.jira.field.comments.label'],
    type: 'textarea',
    hidden: true,
    placeholder: en['type.jira.field.comments.placeholder']
  }
]

// Meeting minutes: the objective drives the agenda, the attachment is
// supporting material, the prompt guides what the agenda should emphasise.
// Deliberately the learning shape minus the wiki-specific note path — the
// minutes land in a plain folder the user owns (FR-010).
export const MEETING_INPUT_SCHEMA: TaskTypeDef['inputSchema'] = [
  {
    key: 'target',
    label: en['type.meeting.field.target.label'],
    type: 'text',
    required: true,
    placeholder: en['type.meeting.field.target.placeholder']
  },
  {
    key: 'filePath',
    label: en['type.meeting.field.filePath.label'],
    type: 'file',
    placeholder: en['type.meeting.field.filePath.placeholder']
  },
  {
    key: 'purpose',
    label: en['type.meeting.field.purpose.label'],
    type: 'textarea',
    placeholder: en['type.meeting.field.purpose.placeholder']
  }
]

// The Learning type's wiki destination, expressed as data rather than as a
// code path (FR-003). `subdir: 'learning-notes'` is the historical default the
// wiki schema and the ingest workflow already speak.
export const LEARNING_DESTINATION: Destination = {
  store: 'wiki',
  rootPath: null,
  subdir: 'learning-notes'
}

export function builtinTypeSeeds(): TaskTypeDef[] {
  return [
    {
      key: 'plain',
      kind: 'plain',
      label: en['type.plain.label'],
      emoji: '📝',
      description: en['type.plain.description'],
      inputSchema: [],
      isBuiltin: true,
      finishBehaviour: 'complete-only',
      grants: { skills: [], toolServers: [] }
    },
    {
      key: 'learning',
      kind: 'learning',
      label: en['type.learning.label'],
      emoji: '🎓',
      description: en['type.learning.description'],
      inputSchema: LEARNING_INPUT_SCHEMA,
      isBuiltin: true,
      // The existing Learning flow, declared: deposit the raw material first,
      // then let the curated note be authored at the wiki's learning-note path.
      finishBehaviour: 'deposit-then-curate',
      destination: LEARNING_DESTINATION,
      grants: { skills: [], toolServers: [] }
    },
    {
      key: 'jira',
      kind: 'jira',
      label: en['type.jira.label'],
      emoji: '🎫',
      description: en['type.jira.description'],
      inputSchema: JIRA_INPUT_SCHEMA,
      isBuiltin: true,
      finishBehaviour: 'complete-only',
      grants: { skills: [], toolServers: [] }
    },
    {
      key: 'meeting',
      kind: 'meeting',
      label: en['type.meeting.label'],
      emoji: '🗓',
      description: en['type.meeting.description'],
      inputSchema: MEETING_INPUT_SCHEMA,
      isBuiltin: true,
      finishBehaviour: 'polish-then-file',
      destination: { store: 'folder', rootPath: defaultMeetingMinutesPath(), subdir: '' },
      grants: { skills: [], toolServers: [] }
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

function parseDestination(value: unknown): Destination | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const d = parsed as Partial<Destination>
    if (d.store !== 'wiki' && d.store !== 'folder') return undefined
    return {
      store: d.store,
      rootPath: typeof d.rootPath === 'string' ? d.rootPath : null,
      subdir: typeof d.subdir === 'string' ? d.subdir : ''
    }
  } catch {
    // Corrupt descriptor → treat as undeclared rather than crash.
    return undefined
  }
}

function parseGrant(value: unknown): PluginGrant {
  if (typeof value !== 'string' || !value.trim()) return { ...NO_GRANT }
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...NO_GRANT }
    const g = parsed as Partial<PluginGrant>
    return {
      skills: Array.isArray(g.skills) ? g.skills.filter((s): s is string => typeof s === 'string') : [],
      toolServers: Array.isArray(g.toolServers) ? g.toolServers.filter((s): s is string => typeof s === 'string') : []
    }
  } catch {
    return { ...NO_GRANT }
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
    isBuiltin: !!r.is_builtin,
    // A row written before v5 has no declared workflow; 'complete-only' is the
    // column default and the only behaviour that needs no destination.
    finishBehaviour: (r.finish_behaviour ?? 'complete-only') as FinishBehaviour,
    destination: parseDestination(r.destination_json),
    grants: parseGrant(r.grants_json)
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
    analysis: r.analysis ?? '',
    suggestions,
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

// `dataDir` defaults to the app's user data root, which is the only place the
// path is derived from: `paths.ts` declares it and this consumes it, rather
// than joining the same filename a second time.
export function openDB(dataDir?: string): DB {
  const root = dataDir ?? userDataDir()
  fs.mkdirSync(root, { recursive: true })
  const dbPath = dbPathIn(root)
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

  // v3 → v4: learning-type refinements (remove link input, add pre-process
  // "analysis" intention field, refresh the built-in learning input schema).
  if (!ran(4)) {
    const ppCols = db.prepare('PRAGMA table_info(task_preprocess)').all() as { name: string }[]
    if (!ppCols.some((c) => c.name === 'analysis')) {
      db.exec('ALTER TABLE task_preprocess ADD COLUMN analysis TEXT NOT NULL DEFAULT \'\'')
    }

    // Built-ins seed via INSERT OR IGNORE, so an already-migrated DB keeps the
    // old learning schema — refresh it here (and strip the removed `link`).
    db.prepare("UPDATE task_types SET input_schema = ? WHERE key = 'learning' AND is_builtin = 1")
      .run(JSON.stringify(LEARNING_INPUT_SCHEMA))

    // Strip `link` from any learning-kind type schema (custom types copied the
    // old built-in schema on creation) and from every task's inputs JSON.
    const stripField = (schema: string): string | null => {
      let parsed: unknown[]
      try {
        parsed = JSON.parse(schema)
      } catch {
        return null
      }
      if (!Array.isArray(parsed)) return null
      const next = parsed.filter((f: any) => f && f.key !== 'link')
      return next.length === parsed.length ? null : JSON.stringify(next)
    }
    for (const t of db.prepare("SELECT key, input_schema FROM task_types WHERE kind = 'learning'").all() as { key: string; input_schema: string }[]) {
      const stripped = stripField(t.input_schema)
      if (stripped) db.prepare('UPDATE task_types SET input_schema = ? WHERE key = ?').run(stripped, t.key)
    }
    const updInputs = db.prepare('UPDATE tasks SET inputs = ? WHERE id = ?')
    for (const t of db.prepare('SELECT id, inputs FROM tasks').all() as { id: string; inputs: string }[]) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(t.inputs)
      } catch {
        continue
      }
      if (parsed && typeof parsed === 'object' && 'link' in parsed) {
        delete parsed.link
        updInputs.run(JSON.stringify(parsed), t.id)
      }
    }
    mark(4)
  }

  // v4 → v5: extensible type workflows. Gives `task_types` a declared finish
  // behaviour, destination and grants, and widens the behaviour-category CHECK
  // on three tables so `meeting` is a legal category.
  if (!ran(5)) {
    const tableDdl = (name: string): string =>
      (
        db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(name) as
          | { sql: string }
          | undefined
      )?.sql ?? ''
    // A table created before this migration names only the three original
    // categories. SQLite cannot ALTER a CHECK, and PRAGMA cannot even read
    // one, so the stored DDL text is the only available signal.
    const isNarrow = (name: string): boolean => {
      const ddl = tableDdl(name)
      return ddl.length > 0 && !ddl.includes("'meeting'")
    }

    // 1. New declarations on task_types. A new column needs no rebuild.
    const typeCols = db.prepare('PRAGMA table_info(task_types)').all() as { name: string }[]
    if (!typeCols.some((c) => c.name === 'finish_behaviour')) {
      db.exec("ALTER TABLE task_types ADD COLUMN finish_behaviour TEXT NOT NULL DEFAULT 'complete-only'")
    }
    if (!typeCols.some((c) => c.name === 'destination_json')) {
      db.exec('ALTER TABLE task_types ADD COLUMN destination_json TEXT')
    }
    if (!typeCols.some((c) => c.name === 'grants_json')) {
      db.exec(`ALTER TABLE task_types ADD COLUMN grants_json TEXT NOT NULL DEFAULT '{"skills":[],"toolServers":[]}'`)
    }

    // 2. Widen task_types (no children — safe to rebuild freely). The new
    //    columns already exist at this point, so they copy across.
    if (isNarrow('task_types')) {
      db.exec('DROP TABLE IF EXISTS task_types_new')
      db.exec(`
        CREATE TABLE task_types_new (
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
        )`)
      db.exec(
        `INSERT INTO task_types_new (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort,
           finish_behaviour, destination_json, grants_json)
         SELECT key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort,
           finish_behaviour, destination_json, grants_json FROM task_types`
      )
      db.exec('DROP TABLE task_types')
      db.exec('ALTER TABLE task_types_new RENAME TO task_types')
    }

    // 3. Widen tasks. It has live child rows in suggestions, ingest_ledger and
    //    task_preprocess, so DROPping it with foreign_keys=ON fails
    //    immediately (documented at the v3 step above and covered by
    //    test/core.test.ts). Same staging-table dance.
    if (isNarrow('tasks')) {
      db.exec('DROP TABLE IF EXISTS tasks_new')
      db.exec('PRAGMA foreign_keys = OFF;')
      try {
        db.exec(`
          CREATE TABLE tasks_new (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL REFERENCES lists(id),
            title TEXT NOT NULL,
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
          )`)
        db.exec(
          `INSERT INTO tasks_new (id, list_id, title, notes, type, custom_type_key, inputs, completed, completed_at,
             in_my_day, my_day_added_at, preprocess_status, preprocess_error, alarm_at, created_at, updated_at, deleted_at)
           SELECT id, list_id, title, notes, type, custom_type_key, inputs, completed, completed_at,
             in_my_day, my_day_added_at, preprocess_status, preprocess_error, alarm_at, created_at, updated_at, deleted_at
           FROM tasks`
        )
        db.exec('DROP TABLE tasks')
        db.exec('ALTER TABLE tasks_new RENAME TO tasks')
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id) WHERE deleted_at IS NULL')
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_mine ON tasks(in_my_day) WHERE deleted_at IS NULL AND in_my_day = 1')
      } finally {
        db.exec('PRAGMA foreign_keys = ON;')
      }
    }

    // 4. Widen task_preprocess (the child, not the parent — safe to rebuild).
    if (isNarrow('task_preprocess')) {
      db.exec('DROP TABLE IF EXISTS task_preprocess_new')
      db.exec(`
        CREATE TABLE task_preprocess_new (
          task_id TEXT PRIMARY KEY REFERENCES tasks(id),
          kind TEXT NOT NULL CHECK (kind IN ('plain','learning','jira','meeting')),
          summary TEXT NOT NULL DEFAULT '',
          analysis TEXT NOT NULL DEFAULT '',
          suggestions_json TEXT NOT NULL DEFAULT '[]',
          generated_prompt TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'none',
          inputs_hash TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`)
      db.exec(
        `INSERT INTO task_preprocess_new (task_id, kind, summary, analysis, suggestions_json, generated_prompt, status, inputs_hash, updated_at)
         SELECT task_id, kind, summary, analysis, suggestions_json, generated_prompt, status, inputs_hash, updated_at FROM task_preprocess`
      )
      db.exec('DROP TABLE task_preprocess')
      db.exec('ALTER TABLE task_preprocess_new RENAME TO task_preprocess')
    }

    // 5. Backfill the built-ins' declared workflow. Learning's behaviour is
    //    re-expressed as a declaration and must reproduce today's flow exactly
    //    (FR-003, SC-003); plain and jira finish locally and write nothing.
    const backfill = db.prepare(
      'UPDATE task_types SET finish_behaviour = ?, destination_json = ? WHERE key = ? AND is_builtin = 1'
    )
    backfill.run('deposit-then-curate', JSON.stringify(LEARNING_DESTINATION), 'learning')
    backfill.run('complete-only', null, 'plain')
    backfill.run('complete-only', null, 'jira')

    mark(5)
  }

  // v5 → v6: drop task inputs a type no longer declares.
  //
  // The v4 step above did this once, by name, for the removed `link` field.
  // This generalizes it, because the hazard is not specific to any one field:
  // input validation rejects an undeclared key on every write, so a task
  // carrying a stale input cannot be edited or finished until it is cleared —
  // and the user would see `unknown input "..."` with no way to act on it.
  //
  // Reconciliation is by EFFECTIVE type, so a task resolving through a custom
  // type is checked against that type's schema, not the built-in's. It only
  // ever REMOVES keys: a declared field that happens to be absent is left
  // alone, because "absent" is a legitimate state the required-inputs gate
  // handles separately.
  if (!ran(6)) {
    for (const t of db.prepare('SELECT key FROM task_types').all() as { key: string }[]) {
      reconcileInputsForType(db, t.key)
    }
    mark(6)
  }

  // v6 → v7: retire the per-task skill/MCP placeholder inputs.
  //
  // Grants are declared on the TYPE (FR-019, contracts/plugin-grants.md §1).
  // The per-task selectors were inert placeholders from before grants existed;
  // keeping them means the inputs form offers a control that appears to
  // configure tooling and does nothing, while the real mechanism lives
  // somewhere else entirely. They are removed from the built-in schemas, and
  // this step removes any trace of them from databases that already hold them.
  //
  // Same shape as v4's `link` removal: strip the field from every type schema
  // (custom types copied the built-in schema on creation), then reconcile each
  // type's tasks so no task is left holding an input its type no longer
  // declares — which validation rejects on every write.
  if (!ran(7)) {
    const RETIRED = ['skill', 'mcp']
    const stripRetired = (schema: string): string | null => {
      let parsed: unknown[]
      try {
        parsed = JSON.parse(schema)
      } catch {
        return null
      }
      if (!Array.isArray(parsed)) return null
      const next = parsed.filter((f: any) => !f || !RETIRED.includes(f.key))
      return next.length === parsed.length ? null : JSON.stringify(next)
    }
    for (const t of db.prepare('SELECT key, input_schema FROM task_types').all() as {
      key: string
      input_schema: string
    }[]) {
      const stripped = stripRetired(t.input_schema)
      if (stripped !== null) db.prepare('UPDATE task_types SET input_schema = ? WHERE key = ?').run(stripped, t.key)
      reconcileInputsForType(db, t.key)
    }
    // A task whose custom type is gone keeps its `type` only; reconcile the
    // built-ins once more so those tasks are covered too.
    for (const t of db.prepare('SELECT DISTINCT type FROM tasks').all() as { type: string }[]) {
      reconcileInputsForType(db, t.type)
    }
    mark(7)
  }

  // v7 → v8: the wiki location moves from a global setting into the types
  // destined for it.
  //
  // The `wikiPath` setting and the built-in `~/Documents/WorkBoard-Wiki`
  // default are retired: a `store: 'wiki'` destination now carries its own
  // absolute rootPath, exactly like a folder destination, and a type without
  // one is refused at Finish rather than silently pointed somewhere.
  //
  // A database whose owner HAD configured a wiki location is not stranded:
  // the stored value is copied into every wiki-rooted destination before the
  // row is dropped. A database that had never set one — it had been riding on
  // the default — is deliberately left unconfigured: materializing the old
  // default here would re-create, in the user's data, the hidden fallback
  // this migration exists to remove.
  if (!ran(8)) {
    const wikiRow = db.prepare("SELECT value FROM settings WHERE key = 'wikiPath'").get() as { value: string } | undefined
    const configured = (wikiRow?.value ?? '').trim()
    if (configured) {
      const rows = db.prepare('SELECT key, destination_json FROM task_types WHERE destination_json IS NOT NULL').all() as {
        key: string
        destination_json: string
      }[]
      const update = db.prepare('UPDATE task_types SET destination_json = ? WHERE key = ?')
      for (const r of rows) {
        const dest = parseDestination(r.destination_json)
        if (dest && dest.store === 'wiki' && !(dest.rootPath ?? '').trim()) {
          update.run(JSON.stringify({ ...dest, rootPath: configured }), r.key)
        }
      }
    }
    db.prepare("DELETE FROM settings WHERE key = 'wikiPath'").run()
    mark(8)
  }

  // v8 → v9: an MCP server row carries the FULL standard server config.
  //
  // The old shape was the app's own invention — `{name, transport: {type:
  // 'stdio', command, args?, env?}}` — which could not express remote servers
  // or any of the adapter's options, i.e. "the input information is not
  // enough to make a MCP working". v9 rewrites every row to
  // `{name, config: {...}}`, where config is the standard `mcpServers.<name>`
  // object the adapter consumes directly. A stdio row maps its fields out of
  // the transport envelope; anything already migrated (or already a full
  // config) passes through untouched, so the step is idempotent; a corrupt
  // value is cleared here rather than surfacing as an unexplained empty list.
  if (!ran(9)) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'mcpServers'").get() as { value: string } | undefined
    if (row) {
      let out = '[]'
      try {
        const arr = JSON.parse(row.value)
        if (Array.isArray(arr)) {
          out = JSON.stringify(
            arr.map((e: any) => {
              if (!e || typeof e !== 'object') return e
              if (e.config !== undefined) return { name: e.name, config: e.config }
              const t = e.transport
              if (t && typeof t === 'object' && typeof t.command === 'string') {
                return {
                  name: e.name,
                  config: {
                    command: t.command,
                    ...(Array.isArray(t.args) && t.args.length ? { args: t.args } : {}),
                    ...(t.env && typeof t.env === 'object' && !Array.isArray(t.env) && Object.keys(t.env).length
                      ? { env: t.env }
                      : {})
                  }
                }
              }
              return e
            })
          )
        }
      } catch {
        out = '[]'
      }
      db.prepare("UPDATE settings SET value = ? WHERE key = 'mcpServers'").run(out)
    }
    mark(9)
  }

  // Seed a default list on first open.
  const row = db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }
  if (row.n === 0) {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(randomUUID(), 'Inbox', now, now)
  }

  // Seed the built-in types (create-only: later edits to their presentation
  // survive because this never overwrites existing rows).
  //
  // This runs OUTSIDE every version gate, so a built-in added to
  // builtinTypeSeeds() (the Meeting type) lands on the next startup of an
  // existing database with no migration step of its own.
  const insType = db.prepare(
    `INSERT OR IGNORE INTO task_types (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort,
       finish_behaviour, destination_json, grants_json)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 1, ?, ?, ?, ?)`
  )
  builtinTypeSeeds().forEach((t, i) =>
    insType.run(
      t.key,
      t.kind,
      t.label,
      t.emoji,
      t.description ?? null,
      JSON.stringify(t.inputSchema),
      i,
      t.finishBehaviour,
      t.destination ? JSON.stringify(t.destination) : null,
      JSON.stringify(t.grants ?? NO_GRANT)
    )
  )
}

// ---- Settings ----

const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  model: '',
  apiKey: null,
  defaultListId: null,
  maxConcurrentJobs: 2,
  showWelcome: true,
  theme: 'light',
  uiLanguage: DEFAULT_LANGUAGE,
  skills: [],
  mcpServers: []
}

function parseSkills(value: unknown): SkillEntry[] {
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is SkillEntry => s && typeof s.name === 'string' && typeof s.path === 'string' && typeof s.description === 'string'
    )
  } catch {
    return []
  }
}

function parseMcpServers(value: unknown): McpServerEntry[] {
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    // Structural parse only — a row with a bad config must still surface so
    // the Settings form can show it and let the user fix or remove it; the
    // domain validator (plugins.ts → mcpConfig.ts) refuses it on save.
    return parsed.filter(
      (s): s is McpServerEntry =>
        s && typeof s.name === 'string' && s.config && typeof s.config === 'object' && !Array.isArray(s.config)
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
    else if (r.key === 'defaultListId') out.defaultListId = r.value || null
    else if (r.key === 'maxConcurrentJobs') out.maxConcurrentJobs = parseInt(r.value, 10) || 2
    else if (r.key === 'showWelcome') out.showWelcome = r.value !== '0'
    else if (r.key === 'theme') out.theme = r.value === 'dark' ? 'dark' : 'light'
    // Clamped rather than trusted: a value written by a newer version, or
    // hand-edited, must leave the app in a language it can actually render.
    else if (r.key === 'uiLanguage') out.uiLanguage = isLanguage(r.value) ? r.value : DEFAULT_LANGUAGE
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
  upsert.run('defaultListId', s.defaultListId ?? '')
  upsert.run('maxConcurrentJobs', String(s.maxConcurrentJobs))
  upsert.run('showWelcome', s.showWelcome ? '1' : '0')
  upsert.run('theme', s.theme === 'dark' ? 'dark' : 'light')
  upsert.run('uiLanguage', isLanguage(s.uiLanguage) ? s.uiLanguage : DEFAULT_LANGUAGE)
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

// The explicit column list is the whole reason every declared field MUST be
// threaded through BOTH the insert list and the ON CONFLICT SET list: a field
// omitted here is silently dropped on save (contracts/type-definition.md
// "Round-trip requirement", verified by test/types.test.ts).
export function upsertType(db: DatabaseSync, t: TaskTypeDef): TaskTypeDef {
  db.prepare(
    `INSERT INTO task_types (key, kind, label, emoji, description, color, input_schema, ai_guidance, is_builtin, sort,
       finish_behaviour, destination_json, grants_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, label=excluded.label, emoji=excluded.emoji,
       description=excluded.description, color=excluded.color, input_schema=excluded.input_schema,
       ai_guidance=excluded.ai_guidance, is_builtin=excluded.is_builtin, sort=excluded.sort,
       finish_behaviour=excluded.finish_behaviour, destination_json=excluded.destination_json,
       grants_json=excluded.grants_json`
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
    0,
    t.finishBehaviour ?? 'complete-only',
    t.destination ? JSON.stringify(t.destination) : null,
    JSON.stringify(t.grants ?? NO_GRANT)
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

// Drop task inputs the type no longer declares. Called on a type save (so a
// narrowed schema cannot strand tasks) and once at startup for databases whose
// schema was already narrowed before this step existed.
//
// Only removes: never invents a value for a declared-but-absent field.
export function reconcileInputsForType(db: DatabaseSync, typeKey: string): number {
  const row = db.prepare('SELECT input_schema, key FROM task_types WHERE key = ?').get(typeKey) as
    | { input_schema: string; key: string }
    | undefined
  if (!row) return 0
  let declared: string[]
  try {
    const parsed = JSON.parse(row.input_schema)
    if (!Array.isArray(parsed)) return 0
    declared = parsed.filter((f: any) => f && typeof f.key === 'string').map((f: any) => f.key)
  } catch {
    return 0
  }
  const allowed = new Set(declared)

  // A task is governed by this type when it names it directly, or when it has
  // no custom type and its built-in `type` is this key.
  const tasks = db
    .prepare(
      `SELECT id, inputs FROM tasks WHERE custom_type_key = ?
       UNION ALL
       SELECT id, inputs FROM tasks WHERE custom_type_key IS NULL AND type = ?`
    )
    .all(typeKey, typeKey) as { id: string; inputs: string }[]

  const upd = db.prepare('UPDATE tasks SET inputs = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  let changed = 0
  for (const t of tasks) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(t.inputs)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const stale = Object.keys(parsed).filter((k) => !allowed.has(k))
    if (stale.length === 0) continue
    for (const k of stale) delete parsed[k]
    upd.run(JSON.stringify(parsed), now, t.id)
    changed++
  }
  return changed
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
      `UPDATE task_preprocess SET kind=?, summary=?, analysis=?, suggestions_json=?, status=?, inputs_hash=?, updated_at=? WHERE task_id=?`
    ).run(p.kind, p.summary, p.analysis, JSON.stringify(p.suggestions), p.status, p.inputsHash ?? '', now, p.taskId)
  } else {
    db.prepare(
      `INSERT INTO task_preprocess (task_id, kind, summary, analysis, suggestions_json, status, inputs_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.taskId, p.kind, p.summary, p.analysis, JSON.stringify(p.suggestions), p.status, p.inputsHash ?? '', now)
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
