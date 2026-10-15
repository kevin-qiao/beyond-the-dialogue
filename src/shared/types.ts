// Shared domain types used by main, preload, and renderer.

// The assistance-family and finish-behaviour vocabularies are declared exactly
// once each — family in src/core/domain/family.ts, finish behaviour in
// src/core/domain/finish.ts, destination store in
// src/core/domain/destination.ts (research D1: each set lives in the module
// that dispatches on it) — and re-exported here so every layer reads the same
// declaration (constitution Principle I/VI).
//
// The retired vocabulary: `TaskCategory` / `TaskType` / `TaskKind` denoted the
// POC's four behaviour categories. Feature 002 deletes them (FR-016); nothing
// dispatches on a category any more.
import type { Family } from '../core/domain/family'
import type { FinishBehaviour } from '../core/domain/finish'
import type { DestinationStore } from '../core/domain/destination'
import type { Language } from '../core/i18n/language'

export type { Family, FinishBehaviour, DestinationStore }

// A task's `type` column holds a built-in Type key ('plain', 'document'); a
// user-defined type is referenced via `customTypeKey` and resolves through the
// task_types registry. The Type's declarations — family, inputs, instruction,
// finish behaviour, destination — govern everything its assistance does
// (FR-012); nothing is inferred from the type key.
export type TaskType = string

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
//
// Feature 002 (research D1, D9): `kind: TaskKind` becomes `family`; the Type
// declaration — family, declared inputs, assistant instruction, finish
// behaviour, destination — is the SOLE determinant of what assistance does
// (FR-012). No grants field is exposed on this shape (D9): every assistance
// this feature runs is confined by construction, so a declared grant would
// pretend to a control that does not exist. The `grants_json` column persists
// with the empty default — the later grants feature adds the field back.
export interface TaskTypeDef {
  key: string
  /** The assistance family, or null when the Type needs no assistance.
   *  `plain` and its user-defined equivalents carry null (research D1). */
  family: Family | null
  label: string
  emoji: string
  description?: string
  color?: string
  inputSchema: TypeInputField[]
  /**
   * The declared assistant instruction — it drives the organize step (D2).
   * The field name stays `aiGuidance`; the comment records what it is now.
   */
  aiGuidance?: string
  isBuiltin: boolean
  // ---- declared workflow (contracts/type-definition.md) ----
  // How Finish behaves. One of four; never inferred from a type key or name.
  finishBehaviour: FinishBehaviour
  // Where finished artifacts go. Absent only for 'complete-only'. An empty
  // rootPath is legal only on the seeded built-in Types (Q1) — a saved user
  // Type is refused at save (FR-013), and the built-in is refused at Finish
  // (FR-007).
  destination?: Destination
  // NO grants field (D9, FR-015, contract: "no grants field is exposed").
  // Grants are storage-only: the `grants_json` column persists with its empty
  // default and `types:save` writes that default whatever a payload carries
  // (T032). Every assistance this feature runs — organize, curate, converse —
  // is confined by construction (`resolveGrant` returns NO_GRANT for a
  // confined purpose, and no declaration can confer reach any more). Withholding
  // the field is what makes the inertness structural: even the configuration
  // cannot pretend. The later grants feature adds the declared field and its
  // UI back together.
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

// Retired machinery kept honest: the `preprocess_status` COLUMN and its stored
// values survive as history (D4 — "Existing `task_preprocess` and `suggestions`
// rows stay in the database. No new code reads them"). Nothing new sets these;
// the renderer no longer surfaces them.
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

// The retired `Suggestion` entity: the `suggestions` table keeps its rows as
// history (D4), and no shipped type reads them. The type is deleted with the
// suggestion engine.

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

// Feature 002 deletes the `preprocess` and `suggestion` job kinds: no code
// enqueues them any more, and only `ingest` (the curation run) is live (D4).
export type JobKind = 'ingest'
// Stored history says otherwise: rows of the retired kinds survive in
// `enrichment_jobs` (contract: "stored rows kept"), so a JobRecord READ back
// from the database can legitimately carry one of those strings. Naming it
// honestly at the read boundary keeps the narrow `JobKind` true for every
// enqueue site.
export type StoredJobKind = JobKind | 'preprocess' | 'suggestion'
export type JobState = 'queued' | 'running' | 'done' | 'failed'

export interface JobRecord {
  id: string
  kind: StoredJobKind
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

// The retired `TaskPreprocess` entity: the `task_preprocess` table keeps its
// rows as history (D4 — "No new code reads them"); the type itself is deleted
// with the preprocess engine.

// ---- Conversations (feature 002, FR-008–FR-011) ----

// A task-owned exchange with the assistant. Conversations are persisted in
// SQLite (v14): they survive restarts (FR-009), they belong to the task
// (cascade delete, final as 001 FR-004), and they never act on the board
// (FR-010). A task may hold several; starting a fresh one leaves the earlier
// ones retrievable.
export interface Conversation {
  id: string
  taskId: string
  createdAt: string
  /**
   * Populated by `conversations:list` summaries only (contract: "summaries:
   * id, createdAt, messageCount"); a single created/fetched Conversation may
   * omit it.
   */
  messageCount?: number
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  // Must not be empty (data-model rule). Stored records keep the language
  // they were written in.
  content: string
  // The chatMessages rule: an assistant entry carries its usage metadata —
  // without it the SDK's context estimator throws inside the provider call.
  usage?: Record<string, unknown> | null
  createdAt: string
}

// ---- Notes ----

export interface TaskNote {
  taskId: string
  notePath: string
  content: string
  updatedAt: string
}

// ---- Wiki / ingest ledger ----

// Feature 002 adds the undo story (FR-020): a completed curation moves
// `done → undone`. A `queued` run whose curation never happened (assistant
// off, D8/FR-021) reads as "did not run" in the Activity view.
export type IngestState = 'queued' | 'running' | 'done' | 'failed' | 'undone'

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
  /** Set by the undo action (v15); null until a `done` run is undone. */
  undoneAt: string | null
  /**
   * The `.history/<run>/` snapshot directory, stored RELATIVE to the
   * collection root (FR-024 portability rule — no absolute path may enter a
   * board row). Taken after the deposit; the order is load-bearing (D7).
   */
  snapshotDir: string | null
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
  notes: Record<string, TaskNote>
  // Redacted by construction (FR-020): the snapshot has no field a secret
  // could be put into. `aiReadiness` replaces the old `aiConfigured` boolean
  // (FR-016, feature 001) with the three declared states.
  settings: RedactedSettings
  taskTypes: TaskTypeDef[]
  aiReadiness: 'not-configured' | 'configured-verified' | 'configured-last-check-failed'
  ingestHistory: IngestRecord[]
  // The preprocess/suggestion snapshot fields are retired with the engines
  // (D4): the rows stay in the database as history, nothing reads them.
}
