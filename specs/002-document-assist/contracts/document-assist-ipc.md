# Contract: Document-Assist IPC Surface (additions to `src/shared/ipc.ts`)

The typed `AppCommands` / `AppEvents` maps (001's pattern) are the single definition;
preload is pass-through; main handlers persist then broadcast. Every command's args and
result and every event payload below exist as types first — drift fails `npm run
typecheck`, not the renderer at runtime. Refusals cross the boundary as localized
strings (`handleCommand` phrases the codes; the domain refuses in codes — constitution
i18n rules).

## Type & destination shape changes

| Item | Change |
|---|---|
| `TaskTypeDef` | `kind: TaskCategory` → `family: Family \| null`; `aiGuidance` gains spec status as the **declared assistant instruction** (field name kept); no grants UI fields exposed (D9) |
| `Destination` | unchanged; `rootPath: ''` legal only on the seeded built-in `document` Type |

## Commands

| Command | Args | Result | Notes |
|---|---|---|---|
| `tasks:finish` | `{ taskId, mode?: 'assisted' \| 'as-written' }` | `{ ok, artifact?: { path, store }, path: 'organized' \| 'as-written' \| 'deposited', assistantStep?: 'failed' \| 'skipped' \| 'ran', issues?: codes }` | mode defaults from the Type declaration; refusal codes for destination-less built-in (`destination.not_configured`), blank draft (`document.empty`), broken location (`destination.unreachable`). `as-written` constructs no session. |
| `conversations:list` | `{ taskId }` | `Conversation[]` (summaries: id, createdAt, messageCount) | available on any task (FR-008) |
| `conversations:create` | `{ taskId }` | `Conversation` | starts fresh; prior conversations remain (FR-009) |
| `conversations:send` | `{ conversationId, content }` | streamed via events; final `{ ok, message?: ConversationMessage, error? }` | grounded on this task's material only (FR-011); never mutates task state (FR-010) — handler receives no task port |
| `conversations:messages` | `{ conversationId }` | `ConversationMessage[]` | restart-persistent (FR-009) |
| `conversations:delete` | `{ conversationId }` | `{ ok }` | task deletion cascades separately (final, 001 FR-004) |
| `types:save` | `TaskTypeDef (family-scoped)` | `{ ok, issues? }` | save-time refusal: destination without location on a user Type (FR-013); incomplete family-scoped validation |
| `types:remove` | `{ key }` | `{ ok, rehomedTo?: 'plain' }` | Tasks in use are re-homed, never orphaned silently (FR-013) |
| `wiki:undoCuration` | `{ recordId }` | `{ ok, restored?: string[], error?: code }` | refuses unless state `done`, snapshot present, wiki resolves (data-model rules); deterministic file restore only |

## Events (broadcast, typed by `AppEvents`)

| Event | Payload | Emitted |
|---|---|---|
| `task.updated` | Task | finish, re-home, type removal |
| `jobs.step` (existing) | step labels incl. the new curate/organize step labels, localized at production (standing rule) | during organized finishes and curation jobs |
| `conversation.updated` | `{ taskId, conversationId, message }` | each persisted turn |
| `artifacts.filed` | `{ taskId, path, store, mode }` | after a successful finish write |
| `ingest.updated` | IngestRecord (now incl. `undoneAt`) | curation queue → done/failed/undone |

## Jobs (internal, not IPC)

`enrichment_jobs` kinds: `preprocess` and `suggestion` **deleted** (handlers
unregistered; triggers gone; rows stay). `ingest` survives re-argued: the same
`depositThenCurate` strategy path from `finishService` (never reimplemented — the
standing rule that the job and the finish share one strategy), snapshot-after-deposit
ordering pinned, undo handled outside the job (a pure file operation on user-owned
data).

## Non-goals of this surface

No grants fields (D9); no preprocess re-trigger; no remote/connector commands
(Working-system family's future); no conversation-influences-finish path (FR-010 keeps
chat read-only against the board).
