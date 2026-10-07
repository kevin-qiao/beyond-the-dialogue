# Tasks: Core Board and Agent Harness

**Input**: Design documents from `specs/001-core-board-and-harness/` (spec.md, plan.md, research.md D1–D8, data-model.md, contracts/core-board-ipc.md, quickstart.md)

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: INCLUDED — the plan's Testing section names the required new unit tests and Constitution Principle IV (NON-NEGOTIABLE) requires headless unit tests for every changed core rule before the feature counts as complete. Test tasks are written to fail before their implementation task lands.

**Organization**: Tasks are grouped by user story (US1 capture-and-run board P1, US2 alarms P2, US3 AI-ready harness P3 from spec.md). The migration ladder and the assistant switch sit in the Foundational phase because they are the same-file (`src/main/db.ts`) / cross-cutting (`index.ts`, `taskService.ts`) prerequisites every story depends on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational and Polish phases carry no story label)
- Exact file paths in every description; line anchors refer to the current POC HEAD and may drift slightly — the symbol names are the contract.

## Path Conventions

Real repo layout (single Electron project, refactor-in-place per plan.md — no new top-level dirs):
`src/shared/` (types.ts, ipc.ts) · `src/core/` (domain/, services/, ports/, i18n/) · `src/main/` (index.ts, db.ts, tasks.ts, alarms.ts, paths.ts, job-queue.ts, adapters/, ai/, wiki/) · `src/preload/index.ts` · `src/renderer/src/` (store.tsx, components/board/, components/focus/, components/overlays/) · `test/` (node:test + tsx, headless).

---

## Phase 1: Setup

**Purpose**: Confirm the green baseline before touching anything.

- [ ] T001 On a short-lived branch cut from `main` (GitHub Flow — never commit into a checked-out `main`), verify `npm run typecheck` and `npm test` both pass in the repo root at the current HEAD; record the output. If either fails, fix or flag before any feature work begins (constitution merge gate).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema ladder (migrations v10–v12, all in `src/main/db.ts` — deliberately serialized here so story phases never conflict on that file), the declared assistant switch (D1), the type-level redaction that every story's settings flow rests on, and the pure attachment rules.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Extend the `Settings` type in `src/shared/types.ts` (~line 183) with the declared `assistantRuntime: 'off' | 'on'` (default **`off`** — research D1) and model-service verification state `lastCheck: { state: 'never-checked' | 'ok' | 'failed'; reason?: string; checkedAt?: string } | null` (data-model "Model-service configuration"); add both keys to `SETTINGS_KEYS` (~line 213) so the `UnlistedSettingKey` compile guard forces listing them; set defaults in `DEFAULT_SETTINGS`, and read/write them in `loadSettings`/`saveSettings` in `src/main/db.ts` (~lines 1026/1067/1088).
- [ ] T003 Create `src/core/domain/assistant.ts`: the pure rule `isAssistantEnabled(settings: Pick<Settings, 'assistantRuntime'>): boolean` — dispatch on the declared value, no other branch shape (Principle I). Add refusal MessageKey `'assistant.disabled'` to `src/core/i18n/en.ts` AND `src/core/i18n/zhCn.ts`. Write `test/assistant.test.ts` first (node:test, tmp-dir free — pure function): default/off ⇒ false, 'on' ⇒ true; confirm it fails, then the module passes it.
- [ ] T004 Gate job enqueues in `src/core/services/taskService.ts`: in `setMyDay` (~line 114) and `updateTask` (~line 58, `shouldRerunPreprocess` ~line 97), when `isAssistantEnabled(settings)` is false the returned `TaskMutationOutcome.enqueue` is `[]` and no `preprocess_status: 'queued'` is ever set — this kills today's plain-task suggestion fire on first My-Day add (research D7; FR-015). Update the existing pins in `test/taskService.test.ts` (the 56–128 block: "never both", unconfigured-gating) and add switch-off cases for plain/learning/meeting; tests red before implementation.
- [ ] T005 Gate finish behaviour in `src/core/services/finishService.ts`: thread the settings (or the enabled flag) through `FinishDeps` and at `resolveBehaviour` (~line 235) make only `complete-only` reachable while the switch is off — a type declaring any other behaviour refuses with `LocalizedError('assistant.disabled')` (D1: "only `complete-only` remains reachable while off"). Add gated-dispatch tests to `test/finishService.test.ts`; `test/finish.test.ts` must also still pass with the switch off by default.
- [ ] T006 Gate job-handler registration in `src/main/index.ts` (~lines 693–695, inside `app.whenReady()`): call `queue.register('preprocess'|'suggestion'|'ingest', …)` only when `isAssistantEnabled(loadSettings(db))`; leave `wireJobEvents` and `requeueInterrupted()` wired regardless. (Note: `JobQueue.enqueue` in `src/main/job-queue.ts` always creates a row regardless of registration — T004 is what prevents unregistered kinds from ever being enqueued; do not rely on the 'no handler' failure path.)
- [ ] T007 Create `src/main/secrets.ts` (main-process-only adapter, research D4): file at `<userData>/pi-agent/secrets.json` (derive the path beside `piAuthPath` in `src/main/paths.ts`), written with mode `0600`, shape `{ machineFingerprint, providerKeys: Record<string,string>, mcpEnv: Record<string, Record<string,string>> }`; export `machineFingerprint()` = hostname + user id, plus `readSecrets()`/`writeSecrets()`. It must import nothing from the renderer boundary and never log values. (Read-time mismatch handling lands in T040.)
- [ ] T008 Write migration **v10 — secrets out** in `src/main/db.ts` `migrate()` (after the v9 step, ~line 954, following the `ran(v)`/`mark(v)` gate pattern): lift the `settings` row `apiKey` and every `mcpServers[].config.env` value into `secrets.ts` storage, replace the settings rows with presence flags, **delete the plaintext values from `settings` after copying** (data-model v10); idempotent — a re-run finds no plaintext and changes nothing. After copying, also strip the plaintext provider key from `<userData>/pi-agent/auth.json` (the POC mirrored it there — research Grounding): v10 must leave no plaintext copy outside `secrets.json`.
- [ ] T009 Headless test for v10 in `test/core.test.ts` (follow the existing migration-test convention at ~lines 154–570): runs once, idempotent re-run, plaintext gone from the `settings` table, presence flag survives, values present in `secrets.json` (use `setUserDataRoot` + tmp dir).
- [ ] T010 Write migration **v11 — `list_id` nullable** in `src/main/db.ts`: gated `tasks` table rebuild — detect the old `list_id TEXT NOT NULL` constraint in `sqlite_master.sql` (per the data-model: "`list_id | nullable — at most one List (FR-006); NULL = unassigned, visible in all-tasks view`"), rebuild with `list_id TEXT REFERENCES lists(id)` AND add `background TEXT` and `target TEXT` columns (FR-002 free text, optional — folded into this rebuild since the table is rebuilt anyway). Wrap the swap in `PRAGMA foreign_keys = OFF` / `finally { PRAGMA foreign_keys = ON }` exactly as the v5 precedent does; any category CHECK restatements keep their comment naming `src/core/domain/categories.ts` (Principle I exception).
- [ ] T011 Headless test for v11 in `test/core.test.ts`: gate fires only on the old schema, task rows and FK integrity preserved, `list_id = NULL` write succeeds after migration, idempotent re-run, `background`/`target` columns present.
- [ ] T012 Write migration **v12 — `task_attachments`** in `src/main/db.ts` (SCHEMA const + `migrate()` step): `task_attachments(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), name TEXT NOT NULL, mime TEXT, path TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)` — data-model Attachment rules verbatim: "`task_id | parent; cascade purge on task delete (FR-004)", "`stored relative path | relative to data-folder root only (FR-021)", "`size | cap enforced at add with a stated refusal". Also add `attachmentsDir()` = `<userData>/attachments` to `src/main/paths.ts` (beside `vaultDir()` ~line 40).
- [ ] T013 Headless test for v12 in `test/core.test.ts`: table created, insert/read round-trip, idempotent.
- [ ] T014 Create `src/core/domain/attachment.ts` — pure rules only (no I/O; the layering test must stay green): `MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024` (the plan's "generous per-file size cap chosen at tasks phase" — fixed here at 50 MiB), `checkAttachment({ size, readable })` returning `MessageIssue[]` with codes `'attachment.tooLarge'` / `'attachment.unreadable'` (both stated reasons surface in the refusal — data-model edge case "huge or unreadable → rejected with a stated reason; the task keeps its other content"), and `storedRelativePath(attachmentId, name)` which is relative-to-data-root **only** (D6: board data contains no absolute filesystem paths). Unit test `test/attachment.test.ts` (red first), including a deliberate-absolute-path refusal.
- [ ] T015 Extend `src/shared/types.ts`: the `Attachment` entity (`id, taskId, name, mime, path (relative), size, createdAt`); `RedactedSettings` — the same shape minus `apiKey`, replaced by `hasApiKey: boolean`, with MCP entries carrying **no env values** (presence flags instead) — the contract's guard is explicit: "No command's request or response type contains a secret string field (type-level redaction: `RedactedSettings` in `shared/types.ts`, not a runtime scrub)"; `SettingsInput` (the only secret-bearing shape: full `Settings` + optional `apiKey`/MCP env values); change `Task.listId` (~line 147) to `string | null`. In `src/shared/ipc.ts`: `AppSnapshot.settings` → `RedactedSettings`, `SaveSettingsArgs.settings` → `SettingsInput`, `CreateTaskArgs/UpdateTaskArgs.listId` accept `null`.
- [ ] T016 Add the redaction/split pure rules to `src/core/services/settingsService.ts`: `toRedacted(settings): RedactedSettings` (drops `apiKey` → `hasApiKey`, strips MCP env values) and `splitInput(input: SettingsInput, existing: { redacted, storedSecrets })` implementing the contract's write-only merge — "**Secret fields present in payload ⇒ store them; absent/empty ⇒ keep existing** (never 'clear by re-save')". Both pure over the ports. Unit tests extend the settingsService block in `test/taskService.test.ts` (~line 167).
- [ ] T017 Make the settings surface redacted end-to-end so all story phases build on it: `buildSnapshot` in `src/main/index.ts` (~line 152) emits `toRedacted(loadSettings(db))`, the `settings:get` handler (~line 531) likewise, and `ev:settings-updated` broadcasts only the redacted shape; `src/renderer/src/store.tsx` snapshot merge retypes to `RedactedSettings`; `src/renderer/src/components/overlays/SettingsView.tsx` converts its provider-key binding to a **write-only field** (settable, never echoed — the MCP section's existing behavior is the pattern to match). `ai:test-connection`'s full-Settings argument stays compilable for now via `SettingsInput` (its secret-free rework is T042). Fix any compile fallout in `src/preload/index.ts` typing.

**Checkpoint**: Schema ladder v10–v12 + tests green; switch declared and gated at the core choke points; redaction is type-level. **No `npm test`/`npm run typecheck` failure may cross this line.** User stories can now proceed, in parallel if staffed.

---

## Phase 3: User Story 1 — Capture and run my daily board (Priority: P1) 🎯 MVP

**Goal**: A user opens the app and gets their whole working day: capture a titled task in seconds, flesh out background/target/additional info (text, links, **application-owned attachment copies**), group into named **Lists with unassign-on-delete**, complete/reopen, and everything survives restart (spec US1, FR-001–FR-006, FR-011).

**Independent Test**: Run a full day of work with AI never mentioned: ≥ 10 tasks with attachments and links, two Lists, complete some, reopen one, restart, nothing lost (spec's Independent Test; quickstart §1/§3/§4). The board run happens with `assistantRuntime: 'off'` (T002 default) so SC-002's zero-egress condition holds automatically.

### Tests for User Story 1 (write first, ensure they FAIL) ⚠️

- [ ] T018 [P] [US1] Rewrite the lists case in `test/core.test.ts` ("lists CRUD: create, rename, delete with tasks", ~line 28): currently pins the **cascade soft-delete** (`listTasks(l.id).length === 0`); pin the FR-006 semantics instead — after `deleteList`, each member task still exists with `listId === null`, visible in the all-tasks query, and the list is gone. Add the rename-collision edge: two Lists with the same name are allowed and both shown as entered.
- [ ] T019 [P] [US1] Create `test/attachments.test.ts` (tmp root via `setUserDataRoot`, real files on disk): copy-in into `attachments/<id>/<name>` survives moving/deleting the source (US1-AC3); over-cap and unreadable sources refuse **with a reason** and the task keeps its other content; stored `path` is relative-only (FR-021); confirmed task delete hard-purges row + file (FR-004 amended); `remove` drops both; open of a missing stored file refuses with a code.

### Implementation for User Story 1

- [ ] T020 [US1] Flip `deleteList` in `src/main/db.ts` (~line 1116): replace the cascade `UPDATE tasks SET deleted_at = …` with `UPDATE tasks SET list_id = NULL WHERE list_id = ?`, then soft-delete only the list row (D3). Keep the existing fan-out: `evListUpdated(null)` already triggers a full `refresh()` in `src/renderer/src/store.tsx` (~line 166) — that is the contract's allowed "batch-unassign event"; the merge is idempotent. `src/main/tasks.ts` `serviceDeleteList` (~line 64) otherwise unchanged.
- [ ] T021 [US1] Carry `listId: string | null` through the main stack: row mappers in `src/main/db.ts` (tasks read/write) and the db-bound wrapper in `src/main/types.ts`; `src/core/services/taskService.ts` `createTask`/`updateTask` accept null membership; FR-001 — confirm the non-empty-title refusal exists as a code at the core edge (`src/core/domain/validation.ts`, phrased via `handleCommand`/`localizeThrown` in `src/main/index.ts`) and add the missing code + test if the check is renderer-only today (`src/renderer/src/components/board/TaskForm.tsx` ~line 30 uses `task.field.titleRequired`).
- [ ] T022 [US1] Background/target on the board task: map the new v11 columns in `src/main/db.ts` row mappers + `src/main/types.ts` into `Task.background`/`Task.target`, persist through `updateTask` args; add the two free-text fields to `src/renderer/src/components/board/TaskForm.tsx` ("additional information" stays the notes editor under `src/renderer/src/components/focus/`, links kept as free text per spec Assumptions).
- [ ] T023 [US1] Create the port `src/core/ports/attachments.ts` (`AttachmentStorePort`: `copyIn(taskId, sourceAbsPath)`, `remove(id)`, `purgeForTask(taskId)`, `resolveStored(id)`) and implement it in `src/main/adapters/attachments.ts`: `fs.copyFileSync` into `attachmentsDir()/<attachmentId>/<original-name>` (data-model Attachment `id` row: "owns the stored file"), guards from `src/core/domain/attachment.ts`, stores the relative path, `openPath` via `shell.openPath` with a missing-file refusal — the copy machinery mirrors `deposit.ts`'s `attachment-<basename>` copy (~lines 26–28) minus the wiki coupling. Register the adapter in `src/main/index.ts`.
- [ ] T024 [US1] Add the three channels **in lockstep** (CLAUDE.md's rule): `attachments:add-from-dialog` (`taskId → Attachment`; main opens the file dialog itself — reuse the `dialog:choose-file` pattern at `src/main/index.ts` ~line 482 but **no markdown filter**, any file type per D2), `attachments:remove`, `attachments:open`, across `src/shared/ipc.ts` (IPC const ~line 6, `AppCommands` ~line 281, arg interfaces), `src/preload/index.ts` (explicit per-channel closures ~lines 6–42), and handlers in `src/main/index.ts` wrapped with `handleCommand` so refusals arrive as localized codes (contract: refusal is a code, "the task survives intact on refusal").
- [ ] T025 [US1] Attachments ride the task aggregate (contract: "New attachments ride `ev:task-updated` … no separate channel until needed"): `buildSnapshot` in `src/main/index.ts` loads attachment lists per task, the task-event payloads in `src/shared/ipc.ts` carry `attachments: Attachment[]`, and `src/renderer/src/store.tsx` merges idempotently alongside `mutateTask`.
- [ ] T026 [US1] Attachment UI in the task detail: a section in `src/renderer/src/components/board/TaskForm.tsx` listing name + size with add / remove / open actions wired to the T024 channels; refusals surface as toasts naming the reason (`ev:toast` exists); no assistant coupling — this section renders regardless of the switch (it is board, US1).
- [ ] T027 [US1] Finality on delete (FR-004 amended): the task-delete path (`IPC.deleteTask` in `src/main/index.ts` ~line 403 → `src/main/tasks.ts` → `deleteTask` in `src/main/db.ts` ~line 1199) additionally calls `purgeForTask` (rows + stored files); alarm consumption on delete already works via the `deleted_at` filter in `src/main/alarms.ts` `pending()` (~line 60) — assert it, don't change it. Confirm the UI confirmation shows the task's title before calling (`src/renderer/src/components/board/TaskContextMenu.tsx` / drawer delete).
- [ ] T028 [US1] Make T018 and T019 green; fix the cascade-dependent pins elsewhere (`test/core.test.ts` restart-persistence ~line 105, `test/taskService.test.ts` fixtures that assume non-null `listId`).
- [ ] T029 [US1] Board e2e story test `test/board.test.ts` (scripted, headless, no AI): two Lists + ≥ 10 tasks (one with an attachment written to a tmp source, then delete the source) → assign/move between Lists → complete + reopen → restart (reopen DB via `setUserDataRoot`) → content, state, List membership and attachment readability intact (US1-AC1–AC6, SC-006; alarms side of the restart is US2's existing test).
- [ ] T030 [P] [US1] i18n: add the story's keys to `src/core/i18n/en.ts` + `zhCn.ts` — `attachment.*` (add/remove/open/tooLarge/unreadable), `list.*` (create/rename/delete + confirm wording naming the count of unassigned tasks / unassigned), `task.field.background`, `task.field.target`; `npm run typecheck` is the parity gate; literal-drift baseline must stay empty (`npx tsx test/helpers/i18nBaseline.ts` diff only shrinks).
- [ ] T031 [US1] Empty states invite capture (spec edge case): `src/renderer/src/components/board/TaskColumn.tsx` / `ListsRail.tsx` show a capture prompt rather than a blank pane when there are no tasks / no Lists / no attachments.
- [ ] T031a [US1] Real List CRUD in the board UI (`src/renderer/src/components/board/ListsRail.tsx`): wire the existing store actions `createList`/`renameList`/`deleteList` (`src/renderer/src/store.tsx` ~lines 46–48 / 327–338 — today they have **zero UI call sites**, research D3(1)) — add-List affordance, rename-in-place, delete with a confirmation naming the count of tasks it will unassign (the `list.*` keys from T030; `TaskColumn.tsx`'s delete confirm is the pattern). The semantics live in main (T020); this is the renderer half of FR-006. **Quickstart §3 is unrunnable until this lands.**

**Checkpoint**: US1 is fully functional and independently testable: `npx tsx --test test/board.test.ts test/attachments.test.ts test/core.test.ts` + the quickstart §1/§3/§4 manual pass. This is the MVP.

---

## Phase 4: User Story 2 — Get told at the right time (Priority: P2)

**Goal**: Set/change/cancel a one-time alarm; while the app runs, a due alarm notifies naming the task; activating the notification focuses the app on that task; completion or deletion consumes it; alarms missed while closed are presented **once, labeled overdue** at next start (spec US2, FR-007–FR-010; research D5 keeps the existing raise-once mechanism and only closes the labeling delta).

**Independent Test**: Alarms at near-future times on several tasks; complete one and delete another before due; only the survivor notifies, opening jumps to it; quit past an alarm and relaunch — presented once labeled overdue, second relaunch silent (spec; quickstart §2).

### Tests for User Story 2 (write first, ensure they FAIL) ⚠️

- [ ] T032 [US2] Extend `test/alarms.test.ts`: the existing "missed alarms raise exactly once at start" case (~line 52) is the base — add: the missed-raise notification carries the **overdue label and the original due time** (its `AlarmFire` payload, not the row — D5 "the task row is not modified" beyond the existing consume-on-fire), the live (in-session) fire carries **no** overdue label, `set-alarm` with a past time refuses with a localized code (FR-007 edge case), completion and deletion both consume a pending alarm (US2-AC4), and a backward clock jump then `reschedule()` never duplicates a fire (edge case "at most one late/missed presentation per alarm").

### Implementation for User Story 2

- [ ] T033 [US2] `src/main/alarms.ts`: extend `AlarmFire` (~line 12) with `dueAt: string` and `overdue: boolean`; `start()` (~line 31) sets `overdue: true` with the original `alarm_at` when re-raising missed alarms, normal `armNext` fires set `overdue: false`. Consumption semantics stay exactly as pinned (fire ⇒ `alarmAt: null`, never re-fires).
- [ ] T034 [US2] `src/main/index.ts` `raiseAlarmNotification` (~line 99): when `fire.overdue`, the `Notification` body/title is built from catalog keys `alarm.overdue.*` — **add these keys to `en.ts` + `zhCn.ts` inside this task**, so the phase checkpoint's typecheck stays green (T048 no longer carries them) — phrased in `loadSettings(db).uiLanguage` and names the original date-time; live fires keep today's plain wording. CLAUDE.md warns the literal-census does **not** see `notify('…')`-style strings — grep this file manually for stray literals. The click path (restore → focus → broadcast `evOpenTask`) already satisfies FR-009; change nothing there.
- [ ] T035 [US2] Past-alarm refusal: ensure the `tasks:set-alarm` write path (`src/main/index.ts` ~line 420 → `src/main/db.ts` / `src/core` validation) rejects `alarmAt ≤ now` with a code surfaced via `handleCommand`/`localizeThrown` — extend `test/core.test.ts` task-alarm cases if the check is missing; keep "alarm time changed / cancelled" paths working (US2-AC1).
- [ ] T036 [US2] Clock-change resilience check (edge case): `armNext` already re-checks due-ness at fire and `reschedule()` re-arms after every mutation (`src/main/alarms.ts` ~lines 65–85, wired at `src/main/index.ts` ~line 92) — confirm with a fake-`now` test that a forward/backward jump yields at most one late presentation per alarm; adjust only if the pin fails.
- [ ] T037 [US2] Run T032 green and re-run the whole suite (`npx tsx --test test/alarms.test.ts`, then `npm test`) — SC-003's "no alarm fires twice" behavior must still hold.

**Checkpoint**: US2 works independently; quickstart §2 manual pass. (Minimized-window delivery FR-008 uses Electron `Notification`, which does not require foreground — verified in the polish manual pass, no code task needed.)

---

## Phase 5: User Story 3 — Make the app AI-ready without using AI yet (Priority: P3)

**Goal**: Configure the model service and verify it with a specific, remembered outcome; manage skills and tool servers as pure configuration; the harness is **honestly inert** (nothing reaches through skills/MCP, no self-granting by mere presence, FR-014/FR-015); readiness is visible from the board (FR-016); secrets are redacted everywhere and machine-bound for the folder-copy story (FR-020/FR-021).

**Independent Test**: With networking disabled, run US1 + US2 completely — zero blocked steps, zero outbound calls (even with keys present: D7). Then connect, mis-connect, and remove an LLM service and observe verified / last-check-failed / not-configured; verify skills and tool servers are managed but nothing constructs sessions or extensions while the switch is off; copy the data folder to a fresh root and see the secret re-request state (spec; quickstart §1/§5/§6; SC-002/SC-008).

### Tests for User Story 3 (write first, ensure they FAIL) ⚠️

- [ ] T038 [P] [US3] Create `test/secrets.test.ts` (`setUserDataRoot` + `machineFingerprint` injection for the mismatch case): file mode 0600; matching fingerprint ⇒ values available main-side; **mismatch ⇒ every value treated as absent** with a re-enter state (FR-021/SC-008, D4); no `toRedacted` output ever contains a secret string; a stale `auth.json` left behind after a fingerprint mismatch is purged, never used (T041a); a deliberate raw-`apiKey` in a snapshot type must be unrepresentable (compile-time — the T050 violation drill).
- [ ] T039 [P] [US3] Create `test/assistantSwitch.test.ts` (the FR-014/FR-015 inertness guard): with the switch off, drive a full board day through the services/handlers while `setSessionFactory` / `setSimplePromptOverride` / `setMcpAdapterFactory` seams count constructions — **count must stay 0**; the assistant channels (`tasks:run-preprocess`, `chat:send/reset`, `remote:*`, `jobs:retry/cancel`, `wiki:activity/retry-ingest`, `suggestions:dismiss`) refuse with the localized `assistant.disabled` code, not a crash; `tasks:finish` on a wiki-destined type refuses while off (T005's gate).
- [ ] T040 [P] [US3] Create `test/portability.test.ts` (D6, mechanical): after a full board scenario (tasks, Lists, attachment added), scan the board tables (`tasks`, `lists`, `settings`, `task_attachments`) for absolute-path-shaped values — only the attachment relative paths persist; then re-point `setUserDataRoot` to a moved copy of the dir and reopen: 100% of board state + attachment readability restored, settings intact, secrets reported absent (FR-021, SC-008).

### Implementation for User Story 3

- [ ] T041 [US3] Finish `src/main/secrets.ts` read path: on load compare stored `machineFingerprint` against the live one; mismatch ⇒ treat all values as absent and record a `re-enter` state; expose `getProviderKey(provider)` / `getMcpEnv(server)` for main-only consumers; makes T038 green.
- [ ] T041a [US3] Keep the SDK's auth store from becoming a second source of truth (`src/main/ai/agent-runtime.ts` ~lines 91–92): the Pi runtime reads `pi-agent/auth.json` itself, so after a folder copy a stale plaintext there would authenticate **silently** and void SC-008's re-enter promise. Rule: `testPrompt`/`applyApiKey` may write `auth.json` only from a `secrets.ts`-resolved key (fingerprint-matched), and whenever the gated read yields no key at startup, the existing `auth.json` provider entry is removed before any runtime use. Pin in `test/secrets.test.ts`: fingerprint mismatch + pre-seeded `auth.json` ⇒ entry gone, key reported absent (FR-020/FR-021; same "materialized output, never the store" pattern as T047's mcp.json).
- [ ] T042 [US3] Secrets-aware save + test in the main handlers (`src/main/index.ts`): `settings:save` (~line 532) runs `splitInput` (T016) — secret material (provider key, MCP env values) goes to `secrets.ts`, never the `settings` table; the **absent/empty ⇒ keep existing** rule from the contract holds; response and `evSettingsUpdated` are the redacted shape only. `ai:test-connection` (~line 553): retypes its `AppCommands` arg to `RedactedSettings` in `src/shared/ipc.ts` (guard: no request carries a secret), resolves the stored key via `secrets.ts` before calling `testPrompt` (`src/main/ai/agent-runtime.ts` ~line 99), and **persists** the outcome into `settings.lastCheck { state, reason, checkedAt }` mapping auth-failure / unreachable / bad-response specifically (FR-012); a failed check blocks nothing and changes nothing else (US3-AC3); make T039's refusal half green alongside T043.
- [ ] T043 [US3] Readiness as a declared three-state rule in `src/core/domain/config.ts`: `aiReadiness(redacted: RedactedSettings, lastCheck): 'not-configured' | 'configured-verified' | 'configured-last-check-failed'` (data-model `{ never-checked | ok | failed(reason) }`) with unit tests in the existing config-adjacent suite; replace the boolean `aiConfigured` consumers — `buildSnapshot` in `src/main/index.ts` (~line 174) emits the state, `src/renderer/src/components/board/ListsRail.tsx` (~lines 58–62, today's `agent.ready`/`agent.notConfigured` footer) and `SettingsView.tsx` render the three states plainly (adding the `readiness.notConfigured/verified/lastCheckFailed` catalog keys inside this task), visible from the board without digging (FR-016, US3-AC5).
- [ ] T044 [US3] Route the assistant channels through `handleCommand` with a `requireAssistant(db)` guard helper in `src/main/index.ts`: each of the T039 channel families throws `LocalizedError('assistant.disabled')` before its legacy logic while off (channels stay **registered** — contract preamble), and MCP/skill configuration surfaces keep working (FR-013) — they are storage management, not capability.
- [ ] T045 [US3] Hide assistant renderer surfaces while off (D1: "Assistant renderer surfaces hide themselves"): in `src/renderer/src/components/focus/` (AI band `TaskBand.tsx`, `ChatPanel.tsx`, `RemoteProposalBar.tsx` — the latter two must render nothing, not refuse-notice), `src/renderer/src/components/overlays/DrawerHost.tsx` / `ChatView.tsx` / `ActivityView.tsx` ingest retry, and the task-type/wiki assistant sections of `SettingsView.tsx` — all keyed off the snapshot's `assistantRuntime`, never a `kind ===` check; the Skills & tool-servers sections **stay visible** (FR-013).
- [ ] T046 [US3] Skills/tool-server management parity check (FR-013/US3-AC4): verify enable/disable/remove of `skills` entries (`src/main/skills.ts`, `skills:*` channels) and add/disable/remove of `mcpServers` rows (`src/core/domain/mcpConfig.ts` validation, SettingsView section) all exist in the UI; fill the gap where missing (e.g. a disable toggle in `SettingsView.tsx`), and pin "after removal nothing reads it" with a test in `test/mcpConfig.test.ts` or `test/plugins.test.ts` (the inertness itself is T039's guard).
- [ ] T047 [US3] Keep the inspection copy correct: `src/main/mcpConfigFile.ts` `buildMcpSettingsJson` (~line 19) and `materializeMcpConfig` (called in `src/main/index.ts` ~lines 538/683) must merge env values from `secrets.ts` (main-only) since the settings rows no longer carry them — the `pi-agent/mcp.json` file keeps its shape for 002; pin `test/mcpConfigFile.test.ts` and `test/mcpRuntime`-style tests with a seeded secret file.
- [ ] T048 [US3] i18n leftovers only: `settings.secret.*` (write-only field wording: set / saved-not-echoed / re-enter-after-copy) — every other story key now lands with its consumer (`assistant.disabled` in T003, `attachment.*`/`list.*`/`task.field.*` in T030, `alarm.overdue.*` in T034, `readiness.*` in T043); re-run the ratchet (`npx tsx test/helpers/i18nBaseline.ts` diff only shrinks).
- [ ] T049 [US3] Make T038–T040 green and run the full suite — SC-002's offline condition now holds even with keys configured (D7 + switch).

**Checkpoint**: All three stories independently functional; the harness is configured, verified, and inert; quickstart §5/§6 manual passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T050 [P] Guard-violation drill (Principle IV: "a gate that cannot fail is treated as broken"): with temporary deliberate violations confirm each guard FAILS — a `apiKey: string` field added to `RedactedSettings` breaks `npm run typecheck` (the contract's type-level redaction test); a `node:fs` import inside `src/core/domain/attachment.ts` breaks `test/layering.test.ts`; a new English literal in `ListsRail.tsx` breaks `test/i18n.test.ts`; an `en` key missing from `zhCn.ts` breaks the catalog parity gate. Revert the violations; note results in the PR body.
- [ ] T051 [P] Full merge gate: `npm run typecheck` (both named projects) and `npm test` green on the final tree.
- [ ] T052 Manual pass of `specs/001-core-board-and-harness/quickstart.md` §1–§7 on **Linux** (the WSL2 dev box counts for §1–§5/§7 but not §2's native-notification evidence if the test name excludes it — record honestly), then append a dated `quickstart-results.md` in the feature dir with SC-003/SC-006/SC-008 observations.
- [ ] T053 [P] Windows parity pass (Principle V, FR-018/SC-007): run quickstart §2 (notification delivery), §5 (secrets), §6 (folder copy) natively on Windows; record deltas in `specs/001-core-board-and-harness/quickstart-results.md` — "works under WSL2" is not shipping evidence (plan.md constraint).
- [ ] T054 [P] Documentation lockstep: update `CLAUDE.md` (migration ladder now v12; new modules `core/domain/attachment.ts`, `core/domain/assistant.ts`, `main/secrets.ts`, `main/adapters/attachments.ts`, `core/ports/attachments.ts`; the three attachment channels; the assistant switch's choke points) and `docs/` (specification/architecture pages touched in the plan's structure tree) to match shipped behavior — the constitution requires specs updated alongside code.
- [ ] T055 Regenerate the i18n baseline (`npx tsx test/helpers/i18nBaseline.ts` — its diff must only shrink), commit everything on the feature branch, and open the PR into `main` (GitHub Flow: merge commit, never squash — the individual commit messages are the record).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002–T017)**: depends on T001. **Blocks all three stories** — T002/T003 (the switch declaration) before anything reads it; migrations v10–v12 (T008–T013) before the data they gate is exercised; T015–T017 (redaction types) before any handler change compiles. Internally: T002 → T003 → {T004, T005, T006}; T007 → T008 → T009; T010 → T011; T012 → T013; T014 independent of the migration chain; T016/T017 depend on T002/T015.
- **User stories (after Foundational)**: US1 (T018–T031a), US2 (T032–T037), US3 (T038–T049, incl. T041a) can proceed in parallel by different workers — they share no files except `src/main/index.ts` and `src/shared/*` (see conflict note below).
- **Polish (T050–T055)**: after all desired stories.

### User Story Dependencies

- **US1 (P1)**: needs Foundational only (v11 gives nullable `list_id` + background/target; v12 the attachment table; T014 the rules). No dependency on US2/US3.
- **US2 (P2)**: needs Foundational only — alarms already work today; this story closes the overdue-label delta (D5). Independent of US1's attachment work.
- **US3 (P3)**: needs Foundational; the switch-off enqueues/registration are already gated there (T004–T006) — US3 adds the handler-level refusals, readiness, and secret flow. Its T043 replaces `aiConfigured` consumers that US1's ListsRail work (T031/T031a) touches — if run in parallel, sequence T043 after T031/T031a to avoid a conflict in `ListsRail.tsx`.

### Within Each Story

- Tests first and RED (T018/T019, T032, T038/T039/T040), then implementation, then the story's green-check task (T028, T037, T049).
- US1: schema/data rules (T020–T022) → port+adapter (T023) → IPC lockstep (T024) → aggregate (T025) → UI (T026) → delete purge (T027).
- `ListsRail.tsx` is a single writer: T031 (empty states) and T031a (List CRUD) may land in either order but never concurrently.

### Conflict note (why some tasks are not [P])

`src/main/db.ts` (migrations — serialized in Foundational), `src/main/index.ts` (T006/T024/T034/T042/T043/T044), `src/shared/ipc.ts` + `src/preload/index.ts` (T015/T024), and `src/renderer/src/store.tsx` (T017/T025) are single-writer files across phases.

### Parallel Opportunities

- Foundational: T003 (+T004/T005/T006 chain) ∥ T007–T013 (db.ts chain, one worker) ∥ T014.
- US1: T018 ∥ T019 (different test files, both RED). US2: T032 standalone. US3: T038 ∥ T039 ∥ T040 (three new files).
- Across stories once Foundational is done (with the ListsRail/db.ts sequencing caveats above).
- Polish: T050 ∥ T051 ∥ T053 ∥ T054.

---

## Parallel Example: User Story 3

```bash
# After Foundational, write all three US3 test files together (all must fail):
Task "T038 test/secrets.test.ts — machine-bound secret store"
Task "T039 test/assistantSwitch.test.ts — inertness guard: zero session/MCP constructions while off"
Task "T040 test/portability.test.ts — folder copy restores the board, secrets absent"

# Then sequentially (shared index.ts):
T041 secrets read-path → T042 save + test-connection → T043 readiness → T044 channel refusals → T045 renderer hiding
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete T001 (Setup) and T002–T017 (Foundational — the switch and migrations are unavoidable groundwork).
2. Complete US1 (T018–T031a).
3. **STOP and VALIDATE**: run the US1 Independent Test — full board day, AI never mentioned, restart-safe; quickstart §1/§3/§4; `npm test` + `npm run typecheck` green. The app is already a shippable daily-driver board at this point (spec: "001's value lands even before anyone configures it").

### Incremental Delivery

1. Foundational → checkpoint (guards green).
2. + US1 → validate independently → ship as the board MVP.
3. + US2 → validate alarms per quickstart §2 → ship with timed nudges.
4. + US3 → validate inertness/readiness/secrets per quickstart §1/§5/§6 → the 002-ready harness is landed.
5. Polish → both-platform quickstart evidence → PR into `main`.

---

## Notes

- [P] = different files, no incomplete dependency. Story label = spec.md US1/US2/US3.
- Every refusal that crosses IPC is a `MessageKey` code localized via `handleCommand`/`localizeThrown` — never a hand-written sentence in `src/core` (constitution + CLAUDE.md).
- The assistant legacy surfaces are **switched off, not deleted** (ADR-0001 / D1): never remove wiki/ingest/chat/MCP code in this feature; only gate reachability.
- `src/core` stays I/O-free: attachment copying, dialogs, `shell.openPath`, secrets file — all behind ports in `src/main`.
- Commit after each phase checkpoint (the branch is the working record; the PR merge is the landing).
- Avoid: same-file parallel tasks, cross-story dependencies beyond the noted Foundational blocking, any outbound call from a board path (SC-002).
