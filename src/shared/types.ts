// Shared domain types used by main, preload, and renderer.

// The behaviour-category and finish-behaviour vocabularies are declared
// exactly once, in src/core/domain/categories.ts, and re-exported here so
// every layer reads the same declaration (constitution Principle VI).
// `TaskType` and `TaskKind` are retained as the names the rest of the code
// already uses; they denote the same set.
import type { TaskCategory, FinishBehaviour, DestinationStore } from '../core/domain/categories'
import type { Language } from '../core/i18n/language'

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
  // Absolute; required for BOTH stores — the location is declared per type,
  // never inherited from a global setting or a built-in default. A wiki-
  // destined type with no rootPath is refused at Finish, never silently
  // pointed somewhere.
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

// ---- Skills & MCP (managed plugin entries) ----

export interface SkillEntry {
  name: string
  description: string
  // Location of the imported skill folder under the app's skills dir.
  path: string
  // FR-013: a disabled skill is retained configuration that nothing may
  // reach through; absence means enabled.
  disabled?: boolean
}

/**
 * One registered MCP server. `config` is the STANDARD server object — whatever
 * `mcpServers.<name>` would hold in a normal `mcp.json` (command/args/env/cwd
 * for stdio, url/headers for HTTP, plus the adapter's optional fields). The
 * app validates only structural sanity (`src/core/domain/mcpConfig.ts`) and
 * passes the rest through to pi-mcp-adapter uninterpreted, which is what makes
 * the full standard configuration round-trippable into mcp.json.
 */
export interface McpServerEntry {
  name: string
  config: Record<string, unknown>
  // FR-013: a disabled tool server is retained configuration that nothing may
  // reach through; absence means enabled.
  disabled?: boolean
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

/**
 * A file the user added to a task, held as the application's OWN copy
 * (FR-002/FR-003). `path` is relative to the data-folder root only (FR-021) —
 * an absolute path would die on the folder-copy move the board promises.
 */
export interface Attachment {
  id: string
  taskId: string
  name: string
  mime: string | null
  /** Relative to the data-folder root; owned by the attachment id. */
  path: string
  size: number
  createdAt: string
}

export interface Task {
  id: string
  /** At most one List (FR-006); null = unassigned, visible in all-tasks. */
  listId: string | null
  title: string
  /** Free text (FR-002): the task's background and its target. */
  background: string
  target: string
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
  /**
   * The task's attachment list, hydrated by the snapshot builder and carried
   * on `ev:task-updated` (contract: "new attachments ride ev:task-updated").
   * Row mappers do not set it; the aggregate read does. Optional so the
   * db-bound Task construction sites stay where they are.
   */
  attachments?: Attachment[]
}

export interface Suggestion {
  id: string
  taskId: string
  text: string
  dismissed: boolean
  createdAt: string
}

// ---- Settings ----

// The declared assistant-runtime switch (research D1). `off` is the default
// for feature 001: the harness is configured, verified, and INERT. Dispatch
// happens through `isAssistantEnabled` (src/core/domain/assistant.ts) — never
// by comparing this string at call sites.
export type AssistantRuntime = 'off' | 'on'

// The outcome of the user's last "check connection" (FR-012), retained so the
// board can show readiness without digging (FR-016). `reason` follows the
// precedent of `tasks.preprocess_error`: a record of what happened, kept in
// the language and text it was produced in.
export interface ModelServiceCheck {
  state: 'never-checked' | 'ok' | 'failed'
  reason?: string
  checkedAt?: string
}

/**
 * The persisted settings shape — and deliberately NOT a secret-bearing one.
 *
 * From migration v10 on, the provider key and every MCP `env` value live only
 * in the machine-bound secret store (`src/main/secrets.ts`). What this shape
 * carries is the PRESENCE (`hasApiKey`; env presence derives from the store on
 * redaction), so no Settings value can ever be mistaken for a secret and this
 * type needs no scrubbing on its way across IPC.
 */
export interface Settings {
  provider: string
  model: string
  /** Presence of a stored provider key (FR-016/FR-020). Never "cleared by re-save". */
  hasApiKey: boolean
  defaultListId: string | null
  maxConcurrentJobs: number
  showWelcome: boolean
  theme: 'light' | 'dark'
  // The language the app's OWN text is shown in (labels, buttons, dialogs,
  // messages) — named `uiLanguage` rather than `language` to say so: it is a
  // presentation choice and must never reach a prompt or shape model output.
  uiLanguage: Language
  // ---- the assistant switch and the verification state (feature 001) ----
  assistantRuntime: AssistantRuntime
  lastCheck: ModelServiceCheck | null
  // Managed plugin entries. MCP servers here are the source of truth for the
  // pi-mcp-adapter grant-gated sessions and are auto-materialized to the
  // app-owned mcp.json (output only). Custom task types live in the task_types
  // table. `disabled` entries (FR-013) are inert configuration the user keeps;
  // the user can re-enable or remove them.
  skills: SkillEntry[]
  mcpServers: McpServerEntry[]
}

/**
 * The ONLY shape that may carry a secret, and only inbound (contract:
 * `settings:save`'s write-only request). `apiKey` present and non-empty ⇒
 * store it; absent or empty ⇒ keep the existing one — never "clear by
 * re-save". MCP env values arrive the same way: inside a pasted server's
 * `config.env`, split out by `splitInput` before anything is persisted.
 */
export interface SettingsInput extends Settings {
  apiKey?: string | null
}

/** One MCP entry as every response sees it: no env values, a presence flag instead. */
export type RedactedMcpEntry = McpServerEntry & { hasEnv?: boolean }

/** What the snapshot, `settings:get`, and `ev:settings-updated` carry (FR-020). */
export type RedactedSettings = Omit<Settings, 'mcpServers'> & { mcpServers: RedactedMcpEntry[] }

/**
 * The shape of the machine-bound secret store (`src/main/secrets.ts`). The
 * file itself is main-process I/O; this shape is shared so the pure split/
 * redaction rules in core can reason about secrets WITHOUT their values —
 * which is exactly the point of the redaction.
 */
export interface StoredSecrets {
  machineFingerprint: string
  /** Provider id → API key. */
  providerKeys: Record<string, string>
  /** MCP server name → env object. */
  mcpEnv: Record<string, Record<string, string>>
}

/**
 * Every field of `Settings`, declared once.
 *
 * Two places need to enumerate the settings: the persistence layer (which reads
 * and writes them one key at a time) and the Settings form's dirty check, which
 * is hand-written field by field — and silently stops enabling Save when a new
 * field is not listed. Both read this instead. The check under the list is what
 * makes that guarantee real: adding a field to `Settings` without naming it here
 * is a compile error.
 */
export const SETTINGS_KEYS = [
  'provider',
  'model',
  'hasApiKey',
  'defaultListId',
  'maxConcurrentJobs',
  'showWelcome',
  'theme',
  'uiLanguage',
  'assistantRuntime',
  'lastCheck',
  'skills',
  'mcpServers'
] as const satisfies readonly (keyof Settings)[]

type UnlistedSettingKey = Exclude<keyof Settings, (typeof SETTINGS_KEYS)[number]>
// `never` when every field is listed; naming the bare type below is the error.
const _everySettingIsListed: UnlistedSettingKey[] = []
void _everySettingIsListed

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
  // Redacted by construction (FR-020): the snapshot has no field a secret
  // could be put into. `aiReadiness` replaces the old `aiConfigured` boolean
  // (FR-016, feature 001) with the three declared states.
  settings: RedactedSettings
  taskTypes: TaskTypeDef[]
  aiReadiness: 'not-configured' | 'configured-verified' | 'configured-last-check-failed'
  ingestHistory: IngestRecord[]
}
