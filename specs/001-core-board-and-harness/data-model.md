# Phase 1 Data Model: Core Board and Agent Harness

Entities per spec Key Entities; validation rules cite FRs. All board data lives under
one `<userData>` folder (FR-021) and references nothing outside it by absolute path
(research D6).

## Task

| Field | Rule |
|---|---|
| id | stable identifier |
| title | required, non-empty (FR-001) |
| background, target | free text, optional (FR-002) |
| list_id | nullable — at most one List (FR-006); NULL = unassigned, visible in all-tasks view |
| state | `active ↔ completed`; reopen allowed (FR-005) |
| my-day flag | board affordance as shipped today; not a spec requirement, retained unchanged |
| alarm_at | nullable instant; one-time (FR-007); past values rejected at write |
| created/updated/completed timestamps | internal |
| deleted | deletion is final: row + attachments + alarm gone, no restore surface (FR-004). Internal tombstones may remain; they are invisible to every view (spec-conform) and purged by a maintenance sweep at tasks-phase discretion |

**State transitions**: `active → completed → active` (reopen); `any → deleted` only via
confirmed intent (FR-004); a completion or deletion **consumes** a pending alarm (FR-009,
US2-AC4).

## List

id, name (as entered; duplicates allowed and shown as entered — edge case), deleted
(final like Task; **deleting a List unassigns its tasks — never deletes them**, FR-006 /
research D3). Membership stored on Task.list_id (v11 makes it nullable via gated
table rebuild).

## Attachment (new — research D2)

| Field | Rule |
|---|---|
| id | owns the stored file: `attachments/<id>/<name>` under the data folder |
| task_id | parent; cascade purge on task delete (FR-004) |
| original name, mime | display metadata as provided at add time |
| stored relative path | relative to data-folder root only (FR-021) |
| size | cap enforced at add with a stated refusal (edge case: huge/unreadable rejected, task keeps other content) |

Rules: copied at add (never referenced in place — FR-003); readable even when the
original moved/vanished (US1-AC3); openable via the OS default handler (FR-002's
"attached files"); no content interpretation in 001.

## Alarm (property lifecycle, not a separate row — stays on Task per today's schema)

`unset → armed (alarm_at set, future) → { fired-consumed | cancelled by user |
consumed by completion | consumed by deletion }`. Fired at time while running (FR-008);
missed-at-start → presented **once, labeled overdue** (FR-010, research D5); clock
changes reschedule, never duplicate (edge case).

## Settings (redacted surface)

UI language (FR-017), assistant runtime switch (`off|on`, default off — research D1),
non-secret provider/model preferences, MCP server configs **minus env values**,
`hasApiKey` presence flag. **No secret values, ever** (FR-020).

## Secret store (new file — research D4)

`<userData>/pi-agent/secrets.json`, mode 0600, main-process-only:
`{ machineFingerprint, providerKeys: {...}, mcpEnv: {<server>: {...}} }`.
Load-time fingerprint mismatch ⇒ all values treated as absent (re-request on first use
after a folder copy — FR-021/SC-008). Secrets never cross IPC in full; they are sent to
their authenticating service only (FR-020).

## Skill / Tool-server records (configured, inert in 001)

Registration data as today (skills folder entries; MCP `{name, config}` rows). FR-014:
while the switch is off, no code path constructs a session, an MCP extension, or an
outbound call from them. Existence ≠ capability (Principle II).

## Model-service configuration

Provider selection, model choice, endpoint prefs, last-check state:
`{ never-checked | ok | failed(reason) }` — surfaced for FR-016 readiness.

## Migrations (schema_migrations ladder continues)

- **v10 — secrets out**: lift `apiKey` and MCP env values from the `settings` table into
  `secrets.json` (machine-bound); settings rows store presence flags. Idempotent; old
  plaintext values deleted from `settings` after copy.
- **v11 — list_id nullable**: gated `tasks` rebuild (`PRAGMA foreign_keys` OFF/finally-ON
  discipline, per the repo's v5 precedent); then `deleteList` semantics change to
  unassign. CHECK restatements that mirror `categories.ts` carry their mirror comment
  (Principle I exception).
- **v12 — task_attachments table** + attachment directory creation under paths.ts.

Each migration ships with a headless test that proves both directions of its guard
(runs once, idempotent re-run, and — where relevant — that a deliberate violation fails
the guard test; Principle IV).
