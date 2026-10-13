# Contract: Document-Assist IPC Surface (additions to `src/shared/ipc.ts`)

The typed `AppCommands` and `AppEvents` maps in `src/shared/ipc.ts` are the single
definition (the 001 pattern). Preload is pass-through. Main handlers store the change,
then broadcast the event. Every command's args and result, and every event payload
below, exists as a type first. A mismatch fails `npm run typecheck`, not the renderer at
runtime. A refusal crosses the boundary as a localized string: `handleCommand` phrases
the codes before the throw, because errors cross IPC as strings and nothing structured
survives.

## Type and destination shape changes

| Item | Change |
|---|---|
| `TaskTypeDef` | `kind: TaskCategory` becomes `family: Family \| null`; `aiGuidance` is now, in name and fact, the declared assistant instruction (the field name stays); no grants field is exposed (D9) |
| `Destination` | unchanged; `rootPath: ''` is legal only on the seeded built-in `document` Type |

## Commands

| Command | Args | Result | Notes |
|---|---|---|---|
| `tasks:finish` | `{ taskId, mode?: 'assisted' \| 'as-written' }` | `{ ok, artifact?: { path, store }, path: 'organized' \| 'as-written' \| 'deposited', assistantStep?: 'failed' \| 'skipped' \| 'ran', issues?: codes }` | the Type's declaration sets the default mode; refusal codes: `destination.not_configured` (the destination-less built-in, Q1), `document.empty` (blank draft), `destination.unreachable` (the location is gone); the as-written mode constructs no session |
| `conversations:list` | `{ taskId }` | `Conversation[]` — summaries: id, createdAt, messageCount | available on any task (FR-008) |
| `conversations:create` | `{ taskId }` | `Conversation` | starts a fresh conversation; earlier ones remain (FR-009) |
| `conversations:send` | `{ conversationId, content }` | streamed through events; the final result is `{ ok, message?: ConversationMessage, error? }` | the context is built from this task's material only (FR-011); a send never changes task state (FR-010) — the handler gives the conversation service no task port |
| `conversations:messages` | `{ conversationId }` | `ConversationMessage[]` | stored, so order survives a restart (FR-009) |
| `conversations:delete` | `{ conversationId }` | `{ ok }` | deleting the task deletes its conversations separately (final, as 001 FR-004) |
| `types:save` | `TaskTypeDef`, family-scoped | `{ ok, issues? }` | save refuses a user Type whose destination has no location (FR-013); validation is family-scoped |
| `types:remove` | `{ key }` | `{ ok, rehomedTo?: 'plain' }` | tasks using the Type are re-homed, never left without a Type in silence (FR-013) |
| `wiki:undoCuration` | `{ recordId }` | `{ ok, restored?: string[], error?: code }` | refuses unless: the state is `done`, the snapshot exists, and the collection resolves (data-model rules); the restore is a code operation on user-owned files |

## Events (broadcast, typed by `AppEvents`)

| Event | Payload | Emitted |
|---|---|---|
| `task.updated` | Task | on finish, on re-home, on Type removal |
| `jobs.step` (existing) | the step labels, including the new organize and curate labels | during an organized finish and a curation job; labels are produced already localized — `jobs.step_label` stores what happened, in the language it happened in |
| `conversation.updated` | `{ taskId, conversationId, message }` | after each stored turn |
| `artifacts.filed` | `{ taskId, path, store, mode }` | after a finish write succeeds |
| `ingest.updated` | IngestRecord, now including `undoneAt` | curation queued → done / failed / undone |

## Jobs (internal, not IPC)

`enrichment_jobs` kinds: the `preprocess` and `suggestion` kinds are deleted — handlers
unregistered, triggers gone, stored rows kept (D4). The `ingest` kind continues the
re-argued path. It calls the same `depositThenCurate` strategy from `finishService`;
the job does not re-implement the finish, and the finish does not re-implement the job —
the standing rule. The snapshot-after-deposit order is pinned by a test (D7). Undo runs
outside the job: it is a code operation on user-owned files, with no session and no
model.

## Non-goals of this surface

No grants field (D9). No preprocess re-trigger. No command that writes to an external
system — connectors belong to the Working-system family and its later feature. No path
by which a conversation changes the board (FR-010 keeps chat read-only against task
state, structurally).
