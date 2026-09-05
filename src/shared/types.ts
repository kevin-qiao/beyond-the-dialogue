// Shared domain types used by main, preload, and renderer.

// ---- Task types (v0.8 type engine) ----

// A task's `type` column holds one of the built-in type keys. A user-defined
// type is referenced via `customTypeKey` and resolves through the task_types
// registry. The kind governs behavior (inputs contract, pre-process, working
// area, finish); custom types choose a kind (design D2).
export type TaskType = 'plain' | 'learning' | 'jira'
export type TaskKind = 'plain' | 'learning' | 'jira'

export const BUILTIN_TYPE_KEYS: TaskType[] = ['plain', 'learning', 'jira']
export const KINDS: TaskKind[] = ['plain', 'learning', 'jira']

// A declared input field on a workflow type. The renderer draws a generic
// form from these; the main `types` service validates task inputs against
// them before persistence.
export interface TypeInputField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'url' | 'file' | 'select'
  required?: boolean
  // Static options for `select` fields (e.g. jira sourceKind).
  options?: { value: string; label: string }[]
  // Dynamic options sourced from settings collections (skill/MCP selectors).
  optionsSource?: 'skills' | 'mcpServers'
  // Placeholder selectors (skill/MCP in v0.8): stored with the task but with
  // no effect on the agent session. Rendered labeled "not yet active".
  inert?: boolean
  // Set at creation only (jira sourceKind): later edits to the value are
  // rejected.
  immutable?: boolean
  // Declared but rendered by the working area, not the generic inputs form
  // (e.g. the jira comment drafts, which live in the task's inputs).
  hidden?: boolean
  placeholder?: string
}

// A workflow type definition — built-in rows (isBuiltin) and user-defined
// types share one registry persisted in the task_types table.
export interface TaskTypeDef {
  key: string
  kind: TaskKind
  label: string
  emoji: string
  description?: string
  color?: string
  inputSchema: TypeInputField[]
  // Extra guidance injected into this type's pre-process system prompt.
  aiGuidance?: string
  isBuiltin: boolean
}

// ---- Skills & MCP (configuration entries, inert in v0.8 — design D6) ----

export interface SkillEntry {
  name: string
  description: string
}

export interface McpTransportConfig {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpServerEntry {
  name: string
  transport: McpTransportConfig
}

// ---- Task management ----

export type PreprocessStatus = 'none' | 'queued' | 'running' | 'ready' | 'failed'

export interface List {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Task {
  id: string
  listId: string
  title: string
  notes: string
  type: TaskType
  // Optional pointer to a user-defined type in the task_types registry. Takes
  // precedence over `type` at display/dispatch time.
  customTypeKey: string | null
  // Values for the effective type's declared inputs (keyed by field key).
  inputs: Record<string, unknown>
  // AI pre-process lifecycle: none → queued → running → ready | failed.
  preprocessStatus: PreprocessStatus
  preprocessError: string | null
  // Optional per-task alarm (ISO timestamp), null = no alarm armed.
  alarmAt: string | null
  completed: boolean
  completedAt: string | null
  inMyDay: boolean
  myDayAddedAt: string | null
  // audit
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Suggestion {
  id: string
  taskId: string
  text: string
  dismissed: boolean
  createdAt: string
}

// ---- Settings ----

export interface Settings {
  provider: string
  model: string
  apiKey: string | null
  wikiPath: string
  defaultListId: string | null
  maxConcurrentJobs: number
  showWelcome: boolean
  theme: 'light' | 'dark'
  // Managed plugin entries (config-only in v0.8; nothing on the agent path
  // reads them). Custom task types moved to the task_types table.
  skills: SkillEntry[]
  mcpServers: McpServerEntry[]
}

// ---- Jobs ----

export type JobKind = 'preprocess' | 'suggestion' | 'ingest'
export type JobState = 'queued' | 'running' | 'done' | 'failed'

export interface JobRecord {
  id: string
  kind: JobKind
  taskId: string | null
  state: JobState
  stepLabel: string | null
  progress: string | null
  error: string | null
  attempts: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

// ---- Pre-process (per-kind AI outputs produced on My Day add) ----

export interface TaskPreprocess {
  taskId: string
  kind: TaskKind
  // Markdown summary produced by the kind's pre-process routine.
  summary: string
  // Dismissible activity suggestion chips (also mirrored into the
  // suggestions table for the existing chip UI).
  suggestions: string[]
  // Working prompt that seeds the task's chat context.
  generatedPrompt: string
  status: PreprocessStatus
  // Hash of the inputs this output was computed from — gates re-runs when
  // relevant inputs change while the task sits in My Day (design D3).
  inputsHash: string
  updatedAt: string
}

// ---- Notes ----

export interface TaskNote {
  taskId: string
  notePath: string
  content: string
  updatedAt: string
}

// ---- Wiki / ingest ledger ----

export type IngestState = 'queued' | 'running' | 'done' | 'failed'

export interface IngestRecord {
  id: string
  taskId: string
  taskTitle: string
  state: IngestState
  depositFiles: string[]
  touchedFiles: string[]
  error: string | null
  attempts: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

// ---- Debug chat ----

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---- Views ----

export interface AppSnapshot {
  lists: List[]
  tasks: Task[]
  suggestions: Suggestion[]
  preprocess: Record<string, TaskPreprocess>
  notes: Record<string, TaskNote>
  settings: Settings
  taskTypes: TaskTypeDef[]
  aiConfigured: boolean
  ingestHistory: IngestRecord[]
}
