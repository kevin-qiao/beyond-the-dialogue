# Contract: Core-Board IPC Surface (feature 001)

The typed `AppCommands`/`AppEvents` maps in `src/shared/ipc.ts` remain the single
declaration; drift is a compile error (Principle I). This contract lists what changes
for 001 and the semantics acceptance tests target. Everything else on the map stays as
shipped; assistant channels (`tasks:run-preprocess`, `chat:*`, `remote:*`,
`jobs:*`, `wiki:*`, `suggestions:dismiss`, and the assistant events) remain
**registered but refused while `assistantRuntime` is off** — refusal arrives as a
localized code, not a crash (Principle II: deterministic guard at the handler).

## Commands — changes and additions

| Channel | Args → Result | Semantics |
|---|---|---|
| `lists:create` / `lists:rename` / `lists:delete` | unchanged | New: renderer call sites (ListsRail); **delete unassigns member tasks** (`list_id = NULL`), never deletes tasks (FR-006, D3) |
| `tasks:create` / `tasks:update` | + `listId?: null` | Title non-empty refusal is a code (`task.title_required`), phrased at the edge |
| `tasks:set-alarm` | unchanged | Past time refused with a code (FR-007) |
| `tasks:delete` | unchanged | Confirmation is UI-guaranteed (FR-004); main stays unguarded by design — the confirm is in front of every call site, and deletion cascades attachment purge server-side |
| **`attachments:add-from-dialog`** (new) | `taskId` → `Attachment` | Copies the chosen file into `attachments/<id>/…`; size cap and unreadable-file refusals are codes; the task survives intact on refusal (edge case) |
| **`attachments:remove`** (new) | `attachmentId` → void | Row + stored file removed |
| **`attachments:open`** (new) | `attachmentId` → void | Opens via OS default handler; missing-file refusal is a code |
| `settings:save` | write-only secrets | Secret fields present in payload ⇒ store them; **absent/empty ⇒ keep existing** (never "clear by re-save"); snapshot never echoes values back (FR-020) |
| `settings:get` / `app:get-snapshot` | result **redacted** | `hasApiKey`, MCP entries without env values; no full secret on any path (FR-020, D4) |
| `ai:test-connection` | `RedactedSettings` arg + state persisted | Result written into model-service `lastCheck {ok | failed(reason)}` for FR-016; the stored key is resolved main-side via `secrets.ts` (T042), so no request but `settings:save`'s carries a secret; failure never blocks saving (US3-AC3) |

## Events

- `ev:settings-updated` — redacted shape (as above).
- `ev:task-updated` / `ev:list-updated` — unchanged payloads; list-delete fan-out emits
  per affected task **or** a batch-unassign event (tasks phase may choose batch; the
  renderer merges either idempotently).
- New attachments ride `ev:task-updated` (task aggregate includes its attachment list —
  no separate channel until needed).
- Assistant events (`ev:job-progress`, `ev:chat-*`, `ev:proposals`, …) simply do not
  fire while the switch is off; no special payload changes.

## Guard expectations (testable, Principle IV)

- No **response, event, or snapshot** type contains a secret string field (type-level
  redaction: `RedactedSettings` in `shared/types.ts`, not a runtime scrub). The single
  sanctioned exception is `settings:save`'s **request** `SettingsInput` (T015): it may carry
  `apiKey`/MCP env values, is write-only, is merged by `splitInput` (T016 — absent/empty ⇒
  keep existing), and is never echoed back on any path. `ai:test-connection`'s request is
  `RedactedSettings` (T042) — the stored key is resolved main-side.
- Layering test still forbids `src/core` I/O; attachment copy logic lives behind the
  port implemented in `src/main/adapters/`; rules in `core/domain/attachment.ts`.
- i18n literal ratchet stays empty with the new UI strings (keys in both catalogs).
- A deliberate secret in a snapshot type fails `npm run typecheck` (the type has nowhere
  to put it).
