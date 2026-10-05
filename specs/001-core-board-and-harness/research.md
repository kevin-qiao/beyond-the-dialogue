# Phase 0 Research: Core Board and Agent Harness

Grounding: a code audit of the POC against spec 001 (audit dated 2026-10-05). Verified
facts used below: List CRUD exists in main but has **zero call sites in the renderer**;
`deleteList` **soft-deletes the List and every task in it**; task delete is UI-confirmed
but leaves orphaned side rows/files; there is **no generic attachment feature** (only a
`filePath` string input on learning/meeting types, copied only at finish);
`AlarmScheduler.start()` already re-raises missed alarms **exactly once** as live
notifications; provider keys are plaintext in the `settings` table, sent **in full in
every settings snapshot across IPC**, and mirrored to `pi-agent/auth.json`; and the
suggestion job fires on first My-Day add for `plain` tasks — an outbound LLM call made
by a "plain board" interaction.

## D1 — Legacy assistant machinery: declared switch, not deletion

**Decision**: add one declared setting `assistantRuntime: 'off' | 'on'` (default `off`
for 001), read at the existing service choke points only: `taskService` job enqueues,
`finishService` behaviour dispatch (only `complete-only` remains reachable while off),
job-queue handler registration (preprocess/suggestion/ingest unregistered), chat,
proposal, and MCP extension construction. Assistant renderer surfaces hide themselves
when the switch is off; all assistant data (types rows, notes, ledger, skills config)
stays untouched.
**Rationale**: FR-014 ("nothing may reach through them", "MUST NOT grant itself access
by mere presence") and FR-015 (suggestion-on-My-Day-add violates it today) are not
satisfiable while the legacy flows auto-run; ADR-0001 has 002 re-litigate and delete
surfaces *as it replaces them* — deleting them in 001 would burn the user's daily
driver ahead of its replacement, and leaving them auto-running falsifies the spec.
**Alternatives considered**: (A) delete all assistant code now — rejected: destroys
artifacts and user value before 002 decides their shape; (B) leave legacy flows
auto-running — rejected: directly violates FR-014/FR-015 and makes SC-002 untestable.

## D2 — Attachments become a real feature: application-owned copies

**Decision**: new `task_attachments` table + `Attachment` entity; files are **copied into
`<userData>/attachments/<attachment-id>/<original-name>`** at add time (via the existing
file-dialog path), stored **relative to the data folder root**, served by IPC handlers
(`attachments:add-from-dialog`, `attachments:remove`, `attachments:open`), and hard-removed
(row + file) when the task is deleted (FR-004 amended: deletion is final). A per-file
size cap is set at tasks phase (a plain constant in `core/domain/attachment.ts`, stated
in the refusal). No content parsing, no Markdown-only filter — any file type.
**Rationale**: FR-002/FR-003 (originals must never break a task), FR-021 (relative paths
keep the folder portable — today's `filePath` input is an absolute reference that dies on
copy), FR-004 (attachments are gone with the task). The legacy `filePath` *input field*
on learning/meeting types is untouched (assistant surface, off by D1).
**Alternatives considered**: reference-in-place (rejected — fails FR-003 durability
outright, per clarification session); storing inside `app.db` as BLOBs (rejected —
bloats the board store, breaks "attachments readable as files" and the folder-copy
story's inspectability).

## D3 — Lists: restore the UI, flip delete semantics to unassign, nullable membership

**Decision**: (1) wire `lists:create/rename/delete` into `ListsRail` (store actions
already exist; only call sites are missing); (2) change `deleteList` to **unassign**
tasks (`list_id = NULL`) instead of cascading soft-delete; (3) migration v11 rebuilds
`tasks` with `list_id` nullable (same gated-rebuild + `PRAGMA foreign_keys` discipline
the repo already documents for v5). "At most one List" (FR-006) is already the shape.
**Rationale**: FR-006 states the semantics; the cascade is exactly the "wrong default"
the clarification flagged (a List delete silently destroying the work in it is worse
than the POC bug class). The single-home data shape is kept; unassigned = the all-tasks
view.
**Alternatives considered**: keep cascade + stronger confirm UI (rejected — spec answers
"unassigning", not "confirming harder"); many-to-many membership (rejected — v1
complication, recorded in the spec's Assumptions).

## D4 — Secrets: redact everywhere, machine-bind for the copy story

**Decision**: (1) move `apiKey` and MCP env secrets **out of the `settings` table** into
`<userData>/pi-agent/secrets.json` (mode 0600) via migration v10, written by a
main-process-only module (`secrets.ts`); (2) every snapshot/event carrying Settings
replaces secret values with presence flags (`hasApiKey: true`); the Settings UI can
*set* a secret (write-only field) but never reads one back (its current MCP section
already behaves this way — the provider key must match it); (3) the secrets file records
a machine fingerprint (hostname + user id); on load, mismatch ⇒ secrets treated as
**absent** and re-requested on first use, satisfying FR-021's "nothing bound except
secrets… re-entered after a copy".
**Rationale**: FR-020 as clarified (user-private files, no OS credential store) plus its
"never reveal in full in any interface" — today the full key crosses IPC into the
renderer on every snapshot, which is a literal FR-020 violation regardless of the
masked input. Machine binding is the only *honest* way to get post-copy re-entry
without keychain integration the user explicitly rejected; it is stated in-app
(US3-AC2's specificity applies to this state too).
**Alternatives considered**: OS credential store (rejected at clarification, Option B);
real encryption with a key stored on the same disk (rejected — theatre); leaving the
key copied along with the folder (rejected — FR-021 says re-entered, and the user chose
that).

## D5 — Missed alarms: keep raise-once, label it overdue

**Decision**: `AlarmScheduler.start()` keeps re-raising each missed pending alarm
exactly once (already true, already test-pinned), but the notification is labeled as
overdue (naming the original time) and the task row is not modified.
**Rationale**: FR-010 demands "once, as overdue, never re-fired or duplicated"; the
current behavior satisfies "once" and "never duplicated" but presents as a live
reminder. Smallest honest change to close the delta; SC-003's "no alarm fires twice"
test already exists.
**Alternatives considered**: in-app overdue list with no notification (rejected — the
user must actually be told when they open the app; a badge they don't look for is
silent).

## D6 — Portability rules become mechanical

**Decision**: board data must contain no absolute filesystem paths (attachments store
relative; migration v10 removes secrets' device-bound values from settings; assistant
`Destination.rootPath` values are excluded from the 001 acceptance surface by D1's
switch). Quickstart adds a copy-and-verify scenario (SC-008) using `setUserDataRoot`
as the test seam.
**Rationale**: FR-021 is a folder-copy promise; an absolute path anywhere in the board
store silently breaks it. Guardable as a test (scan the board tables for path-shaped
values).
**Alternatives considered**: export/import UI (rejected at clarification — Option A
chosen).

## D7 — Suggestion job on plain My-Day add: switched off, deliberately

**Decision**: with `assistantRuntime: 'off'`, the plain-task suggestion enqueue never
happens; the code path stays for 002 to re-litigate (it is assistant behavior attached
to a board interaction — exactly what FR-014 forbids while the harness is meant inert).
**Rationale/alternatives**: as D1; noted separately because the audit found this is the
one place a *plain* task already reaches the network when a provider happens to be
configured — the offline acceptance test (SC-002) must therefore run with the switch
off even when keys exist.

## D8 — Technology baseline stays (no NEEDS CLARIFICATION left)

TypeScript/Electron/node:sqlite/Pi-SDK at the existing seams; migrations continue the
numbered `schema_migrations` ladder (v10–v12). The redesign's freedom to remove
(ADR-0001) is exercised by *displacing*, not deleting: deletion happens in the slice
whose replacement makes each legacy surface dead.
