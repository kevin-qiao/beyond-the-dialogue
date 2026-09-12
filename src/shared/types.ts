// Shared domain types used by main, preload, and renderer.

// The behaviour-category and finish-behaviour vocabularies are declared
// exactly once, in src/core/domain/categories.ts, and re-exported here so
// every layer reads the same declaration (constitution Principle VI).
// `TaskType` and `TaskKind` are retained as the names the rest of the code
// already uses; they denote the same set.
import type { TaskCategory, FinishBehaviour, DestinationStore } from '../core/domain/categories'

export type { TaskCategory, FinishBehaviour, DestinationStore }

// A task's `type` column holds a category key. A user-defined type is
// referenced via `customTypeKey` and resolves through the task_types registry.
// The category governs pre-processing and the working area; the type's own
// `finishBehaviour` and `destination` govern Finish.
export type TaskType = TaskCategory
export type TaskKind = TaskCategory

// ---- Destinations (contracts/destination.md) ----

// Where a type's finished artifacts are written. Declared as structured data
// and resolved at write time, so confinement is checkable by construction.
export interface Destination {
  store: DestinationStore
  // Absolute; required for 'folder', MUST be null for 'wiki' (the configured
  // wiki location is used instead).
  rootPath: string | null
  // Relative directory under the root; '' means the root itself.
  subdir: string
}

// A destination after its root has been determined. `absRoot` is root+subdir,
// normalized; the artifact filename is derived at write time, never stored.
export interface ResolvedDestination {
  store: DestinationStore
  root: string
  subdir: string
  absRoot: string
}

// ---- Plugin grants (contracts/plugin-grants.md) ----

// The capabilities a type's *interactive* sessions may use. Confined
// operations never receive a grant, by construction.
export interface PluginGrant {
  skills: string[]
  toolServers: string[]
}

export const NO_GRANT: PluginGrant = { skills: [], toolServers: [] }

export function hasAnyGrant(grant: PluginGrant | undefined | null): boolean {
  if (!grant) return false
  return (grant.skills?.length ?? 0) > 0 || (grant.toolServers?.length ?? 0) > 0
}

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
  // Dynamic options sourced from settings collections.
  //
  // RETAINED AFTER v7, WITH NO SHIPPED USER: the per-task skill/MCP selectors
  // that used these were removed because grants are declared on the TYPE
  // (FR-019) — a per-task selector duplicated a working mechanism and its
  // "not yet active" label was untrue. The mechanism stays because it encodes
  // a rule the design depends on and a test pins deliberately: an inert field
  // is stored but must not affect the agent session, and must not invalidate a
  // pre-process run (design D3, test/triggers.test.ts). Removing it would
  // remove that rule. No built-in type declares one today.
  optionsSource?: 'skills' | 'mcpServers'
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
  // ---- declared workflow (contracts/type-definition.md) ----
  // How Finish behaves. One of four; never inferred from the category.
  finishBehaviour: FinishBehaviour
  // Where finished artifacts go. Absent only for 'complete-only'.
  destination?: Destination
  // Skills/tool servers granted to this type's interactive sessions.
  grants: PluginGrant
}

// ---- Skills & MCP (configuration entries, inert in v0.8 — design D6) ----

export interface SkillEntry {
  name: string
  description: string
  // Location of the imported skill folder under the app's skills dir.
  path: string
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
  // One-sentence guess of the user's likely intention behind the request.
  analysis: string
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
