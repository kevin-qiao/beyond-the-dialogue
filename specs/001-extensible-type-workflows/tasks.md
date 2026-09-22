---
description: "Task list for Extensible Type Workflows"
---

# Tasks: Extensible Type Workflows

**Input**: Design documents from `specs/001-extensible-type-workflows/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: **NOT optional for this project.** The constitution makes complete unit test
coverage non-negotiable (Principle IV), and two success criteria are defined in terms of
tests — SC-003 ("existing learning workflow tests continuing to pass unmodified") and
SC-006 ("zero confined background operations receive externally granted tools"). Test tasks
below are requirements, not suggestions.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are given in every task

**Terminology**: the spec says "behaviour category" and "output destination" where the code
says `kind` and `destination`. Same concepts; the spec wording keeps the document readable
for non-technical stakeholders (spec.md Assumptions).

## Path Conventions

Single repository, layered in place (see plan.md). Paths are repository-relative:
`src/shared/`, `src/core/`, `src/main/`, `src/renderer/`, `test/`.

**A note on where things live**: `src/core/` is a new layer but not a new directory — it is
already in the `include` array of both `tsconfig.node.json` and `tsconfig.web.json`. It MUST
NOT import `electron`, `node:*`, or DOM globals. Adapters in `src/main/adapters/` are where
platform APIs are touched.

---

## Phase 1: Setup

**Purpose**: Establish a known-good baseline before touching anything.

- [X] T001 Capture the baseline: run `npm test` and `npm run typecheck`, record the exact pass/fail state in the commit message or a scratch note. This is the reference SC-003 is judged against; without it a later regression is unattributable.
- [X] T002 Create the core layer skeleton: `src/core/domain/`, `src/core/services/`, `src/core/ports/` per plan.md structure. Add a guard test in `test/layering.test.ts` asserting no file under `src/core/` contains an `electron`, `node:` or DOM import (research R1, plan Phase 1).
- [X] T003 [P] Add `src/core/README.md` stating the layering rule in one paragraph: core is domain + application only, I/O arrives through ports, and it is bundled into both the main and renderer targets so environment-specific imports break one of them.

**Checkpoint**: Baseline recorded, core layer exists, layering rule machine-checked.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The layering, the schema, and the destination mechanism that every user story
depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Ports and the category declaration

- [X] T004 [P] Define port interfaces in `src/core/ports/`: `storage.ts` (StoragePort), `artifactStore.ts` (ArtifactStorePort — `prepare`/`writeArtifact`/`deposit`/`snapshot`/`diff` per contracts/destination.md §2), `agent.ts` (AgentSessionPort), `notifier.ts`, `clock.ts`. Interfaces only — no implementations.
- [X] T005 Create `src/core/domain/categories.ts` as the single declaration of the category set (`plain | learning | jira | meeting`) and the finish-behaviour set (`complete-only | file-as-is | polish-then-file | deposit-then-curate`). Then retire the four restatements listed in data-model.md §7.4: `src/shared/types.ts:9-13`, `src/main/types.ts:102`, `src/main/types.ts:123` (the `new Set(['plain','learning','jira'])`), and give `BUILTIN_TYPE_KEYS` a purpose or delete it (it is currently dead). Constitution Principle VI: a literal repeated in more than one place MUST be declared once.
- [X] T006 [P] Add a comment to each SQL `CHECK` that restates the category set in `src/main/db.ts` — naming `src/core/domain/categories.ts` as the declaration it mirrors, and stating that SQL cannot reference a TypeScript constant. This is the unavoidable-hardcoding case Principle VI requires be documented rather than left bare.

### Schema v5

- [X] T007 Add migration step v5 to `migrate()` in `src/main/db.ts` (current max is `ran(4)` at `:504`; use the same `if (!ran(5)) { ...; mark(5) }` shape). Include: `ALTER TABLE task_types ADD COLUMN finish_behaviour TEXT` defaulting to `'complete-only'`, `destination_json TEXT` (NULL), `grants_json TEXT` defaulting to `'{"skills":[],"toolServers":[]}'`. Seed the `SCHEMA` constant at `db.ts:57-68` to match for fresh installs.
- [X] T008 Backfill existing built-ins in the v5 step using the `UPDATE ... WHERE key = ? AND is_builtin = 1` pattern from `db.ts:512`: `learning` → `finishBehaviour: 'deposit-then-curate'` with a wiki destination (`store: 'wiki'`, `rootPath: null`, `subdir: 'learning-notes'`); `plain` and `jira` → `'complete-only'` with a null destination.
- [X] T009 Rebuild the three tables carrying the task-category `CHECK` so the constraint accepts `meeting`: `tasks` (`db.ts:40`, restated at `:392`), `task_types` (`:59`), `task_preprocess` (`:87`). Copy the v3 rebuild pattern (`db.ts:383-428`). **The `tasks` rebuild MUST wrap the swap in `PRAGMA foreign_keys = OFF` / `finally { PRAGMA foreign_keys = ON }`** — it has live child rows in `suggestions`, `ingest_ledger`, and `task_preprocess`, and dropping it with FKs on fails immediately (documented at `db.ts:379-382`, covered by `test/core.test.ts:187-190`). Gate each rebuild by detecting the old constraint in `sqlite_master.sql`, per `db.ts:434-457`.
- [X] T010 Add the Meeting built-in to `builtinTypeSeeds()` in `src/main/db.ts:172-202` (key `meeting`, kind `meeting`, label Meeting, emoji 🗓, finishBehaviour `polish-then-file`, a folder destination, and its declared inputs). No migration step is needed for the seed itself — this function runs outside every version gate at `db.ts:555-561` and inserts with `INSERT OR IGNORE`, so it lands on the next startup of an existing database.
- [X] T011 [P] Add migration tests in `test/core.test.ts`: v5 applies to a legacy database, is idempotent on re-run, preserves existing tasks, and backfills the learning type's behaviour correctly. Assert the widened constraint accepts `meeting` and still rejects an unknown value.

### Destination mechanism

- [X] T012 Create `src/core/domain/destination.ts`: the `Destination`/`ResolvedDestination` shapes from contracts/destination.md, plus `resolveRoot` and `resolveArtifact`. The confinement test MUST be `relative()` + not-`..`-prefixed + not-absolute, lifted from `resolveLearningNotePath` (`src/main/wiki/wiki.ts:121-132`) rather than reimplemented — two implementations of a security check drift invisibly.
- [X] T013 [P] Add `test/destination.test.ts` covering contracts/destination.md §5: an absolute `rootPath` is required for `store: folder`; `subdir` containing `..` is rejected; a path resolving outside the root is refused; a relative or empty `rootPath` is rejected; `store: wiki` requires a null `rootPath`.
- [X] T014 Implement the folder artifact store in `src/main/adapters/artifacts/folderStore.ts` against `ArtifactStorePort`. `prepare()` MUST verify the destination exists and is writable so the failure surfaces **before** the task is marked complete. `writeArtifact()` MUST NOT overwrite or relocate — a collision gets a distinct name alongside (FR-026).
- [X] T015 [P] Add `test/artifactStore.test.ts` for `src/main/adapters/artifacts/folderStore.ts`: `prepare()` rejects a **missing** destination and an **unwritable** one; `writeArtifact()` on a filename collision writes a distinct name and leaves the first file byte-identical; no file is ever moved or deleted. This is the failure path FR-026 and FR-027 depend on, and it is distinct from T013's resolution tests and T024's collision test — those cover the resolver and the finish, not the store's own error handling.
- [X] T016 Move the wiki artifact behaviour behind `ArtifactStorePort` in `src/main/adapters/artifacts/wikiStore.ts`, delegating to the existing `src/main/wiki/wiki.ts` functions unchanged. Do **not** generalize the ingest internals: introduce the port and let the wiki store delegate, so `deposit-then-curate` keeps behaving identically (research R4; SC-003 depends on this).

### Composition and transport

- [X] T017 Introduce the typed command and event maps in `src/shared/ipc.ts` per contracts/app-client.md §3, replacing the untyped `broadcast(event: string, payload: unknown)` at `src/main/index.ts:121-125`. Every event payload gets a named type so a second host cannot silently disagree about a shape.
- [X] T018 *(done for the workflow-bearing handlers; see the note at the end of this phase)* Refactor `src/main/index.ts` into a composition root: resolve the user data root, construct adapters, construct services, register the transport. Move the ~10 workflow-bearing handlers identified in plan.md (`:202-255`, `:256-266`, `:279-296`, `:321-355`, `:397-427`) into `src/core/services/`. Leave the ~21 thin pass-throughs wired as they are.
- [X] T019 Resolve the duplicated database path: `openDB` joins `dataDir/app.db` (`src/main/db.ts:343`) while `paths.appDbPath()` computes the same value independently (`src/main/paths.ts:20`), and `src/main/index.ts:466` passes the Electron path in directly, bypassing the portability seam. Declare it once and consume it from there (Principle VI). (Not `[P]`: touches `src/main/db.ts`, as does T006.)
- [X] T020 Verify the full existing suite still passes after the refactor with **no edits to existing tests**: run `npm test` and `npm run typecheck` over `test/*.test.ts`. This is the SC-003 boundary; if a test needs changing to accommodate the refactor, that is a finding to justify, not an adjustment to make.

**Checkpoint**: Foundation ready — schema accepts the new category, destinations resolve and confine, the core layer exists, and existing behaviour is provably unchanged.

> **T018 — scope note.** The five workflow-bearing handler ranges the plan named were
> addressed as follows: `createTask`/`updateTask` (`:202-255`) → `src/core/services/taskService.ts`;
> `setMyDay` (`:279-296`) → the same service; `finishTask` (`:321-355`) →
> `src/core/services/finishService.ts`; `saveSettings` (`:397-427`) →
> `src/core/services/settingsService.ts`; the chat grounding half of `:412-427` →
> `buildSessionContext` in `src/core/domain/grant.ts`. The `runPreprocess` handler
> (`:256-266`) was **not** moved: it is a ten-line guard-and-enqueue whose actual work
> already lives in the job handler and the core registry, so extracting it would add a
> port without moving a rule. `src/main/index.ts` still composes adapters, services and
> the transport, and the rules it used to hold are now reachable from tests
> (`test/taskService.test.ts`) rather than only from a running Electron window.

---

## Phase 3: User Story 1 - Meeting tasks from agenda to filed minutes (Priority: P1) 🎯 MVP

**Goal**: A Meeting task can be pre-processed for an agenda and topics, written up in the
working area, and finished into a polished plain-markdown file in a configured folder.

**Independent Test**: Create a meeting task, add to My Day, pre-process, write minutes,
Finish, and verify a polished markdown file exists at the configured location containing a
distinct action-items section, with the task marked complete — with no other story
implemented.

### Tests for User Story 1

> Write these FIRST and confirm they FAIL before implementing.

- [X] T021 [P] [US1] `test/finish.test.ts` — the four behaviours: `complete-only` writes nothing; `file-as-is` writes content unchanged; `polish-then-file` runs the assistant then writes; `deposit-then-curate` deposits before authoring. Assert `complete-only` with a destination is a validation error.
- [X] T022 [US1] `test/finish.test.ts` — the polish bound (FR-009, SC-011): with a scripted session that tries to **inject** a decision the user never recorded, assert the finish is caught as a failure. Also assert the recorded action items appear as a distinct section.
- [X] T023 [US1] `test/finish.test.ts` — degradation: with no provider configured, a `polish-then-file` finish still completes and files the content unpolished, reporting the assistant step as skipped/failed (FR-025, FR-011).
- [X] T024 [P] [US1] `test/destination.test.ts` — collision: two finishes producing the same filename leave both files present under distinct names, with the first unmodified and nothing relocated (FR-026, SC-008).
- [X] T025 [P] [US1] `test/e2e.test.ts` — the meeting journey end to end with scripted sessions, covering quickstart.md S1 steps 1–6. Include an assertion that written minutes persist **without an explicit save action** (FR-008); step 4 of S1 currently states the expectation but nothing verifies it.
- [X] T026 [US1] `test/finishService.test.ts` — unit-test `src/core/services/finishService.ts` directly (not via the e2e path): the destination is validated **before** the task is marked complete; the task is **not** marked complete when destination validation or the artifact step fails; the failure reaches the activity record. T025 covers the happy path only.
- [X] T027 [US1] `test/e2e.test.ts` — the failure-loud test per quickstart.md S7: the resolver falls back to `'plain'` (`src/main/types.ts:93-95`), so a missing branch degrades silently. Assert a meeting task routes to the meeting surface and meeting pre-process, **not** plain behaviour.

### Implementation for User Story 1

- [X] T028 [US1] Implement the four finish strategies in `src/core/domain/finish.ts` against the `FinishStrategy` contract in contracts/finish-behaviours.md, returning `{ artifactPath, assistantStep, touchedFiles }`.
- [X] T029 [US1] Implement `src/core/services/finishService.ts`: validate destinations and required inputs **before** marking complete, preserve the user's content unconditionally, dispatch on `finishBehaviour` (not on category), mark complete and clear the alarm, and report the outcome to the activity record (FR-028). Replaces the hardcoded `effectiveKind(...) === 'learning'` branch at `src/main/index.ts:348`.
- [X] T030 [US1] Add Meeting pre-processing: a prompt producing a suggested agenda and core topics from the task's own declared inputs, dispatched by category. Replace the binary `kind === 'learning' ? learningPrompt : jiraPrompt` at `src/main/preprocess.ts:121-124` with a per-category registry.
- [X] T031 [US1] Route the Meeting working area to the existing markdown editing surface in `src/renderer/src/components/focus/` — currently a ternary on `effectiveKind` at `FocusColumn.tsx:78`. Per-type working-area declaration is out of scope; the category still selects the surface.
- [X] T032 [US1] **Extend the snapshot/diff walk.** `listExistingWikiFiles` currently walks a hardcoded `['wiki','learning-notes']` (`src/main/wiki/wiki.ts:228`), so any new destination directory is invisible to the audit trail. Derive the walk from the destinations actually in use. Without this, every finish still reports success while the audit trail is silently empty — worse than an error, because nothing signals it. Also make `ensureWikiDir`'s hardcoded `learning-notes` creation conditional on the destination being used (`wiki.ts:37-57`).
- [X] T033 [US1] Add the Meeting finish reporting path in `src/core/services/finishService.ts` and surface it in `src/renderer/src/components/overlays/ActivityView.tsx`, so a meeting finish appears in the Activity view with the files it actually touched, and a failure is retriable without retyping (FR-027, FR-028).
- [X] T034 [US1] Bound the polish input: apply the same 200,000-character truncation the pre-process path already uses (`src/main/preprocess.ts:70`) to the minutes handed to the assistant, so minutes larger than the model can process degrade predictably rather than failing. Assert the bound in `test/finish.test.ts`.

**Checkpoint**: User Story 1 is fully functional and independently testable — the MVP.

---

## Phase 4: User Story 2 - Choosing where a type's finished work goes (Priority: P2)

**Goal**: The destination is visible and editable per type, and a change affects subsequent
finishes only.

**Independent Test**: Change a type's destination in settings, finish a task, verify the
artifact lands in the new location; verify earlier artifacts are untouched in their original
location.

### Tests for User Story 2

- [X] T035 [US2] `test/destination.test.ts` — a destination change applies to subsequent finishes only; an artifact written before the change remains present and unmodified (FR-005).
- [X] T036 [P] [US2] `test/types.test.ts` — type round-trip: read a type, edit it, save, read again, and assert every declared field survives including `finishBehaviour`, `destination`, and `grants`. The persistence statement writes an explicit column list (`src/main/db.ts:756-776`), so an omitted field is silently dropped on save — thread each new column through both the insert list and its `ON CONFLICT DO UPDATE SET` clause.

### Implementation for User Story 2

- [X] T037 [US2] Expose the destination per type in `src/renderer/src/components/overlays/SettingsView.tsx` (the type editor at `:526-652`), with a folder picker for `store: folder` and a read-only display of the resolved wiki location for `store: wiki`.
- [X] T038 [US2] Re-express the Learning type as `finishBehaviour: 'deposit-then-curate'` plus a wiki destination, replacing the application-wide `Settings.wikiPath` read at `src/main/wiki/wiki.ts:146` and `src/main/wiki/ingest.ts:29` with the type's declared destination. Behaviour must be identical; T039 verifies this immediately after.
- [X] T039 [US2] Verify the existing Learning-type tests pass **unmodified** after Learning is re-expressed as a destination declaration: `test/e2e.test.ts`, `test/wiki.test.ts`, `test/queue.test.ts` (SC-003, quickstart.md S5). Do not edit them; report any that fail.
- [X] T040 [US2] Generalize the finish-time confinement check at `src/main/index.ts:335-341` (currently hardcoded to `inputs.learningNotePath` and `resolveLearningNotePath`) to be destination-aware, preserving the refuse-rather-than-mis-save behaviour (FR-006).
- [X] T041 [US2] Add destination validation to the type-save path: a writing behaviour requires a destination; `complete-only` forbids one; `subdir` must be relative with no `..` segment (contracts/destination.md §5).

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Users define their own types (Priority: P3)

**Goal**: A user creates a type declaring its own prompt, destination, and finish behaviour,
and the whole workflow follows the declaration with no code changes.

**Independent Test**: Define a custom type entirely from settings, create a task of it,
verify pre-processing uses the custom prompt and Finish routes to the declared destination.

### Tests for User Story 3

- [X] T042 [US3] `test/types.test.ts` — a custom type's declared prompt is reflected in the pre-process instruction, and its destination/behaviour route the finish (SC-004). (Not `[P]`: shares the file with T036, and US2/US3 may run in parallel.)
- [X] T043 [US3] `test/types.test.ts` — validation: an unrecognised `finishBehaviour` is rejected (never silently defaulted); a built-in's category and behaviour are immutable on update while its display fields remain editable (FR-017).
- [X] T044 [US3] `test/types.test.ts` — deleting a custom type reassigns referencing tasks via `reassignTasksFromType` (`src/main/db.ts:784-787`) and destroys nothing; already-written artifacts remain on disk (FR-016).

### Implementation for User Story 3

- [X] T045 [US3] Extend the type editor in `src/renderer/src/components/overlays/SettingsView.tsx` with a finish-behaviour selector and an AI-instruction field; today it can only pick a category and toggle that category's built-in fields (`:94-95`, `:610-638`).
- [X] T046 [US3] Extend type-definition validation in `src/core/domain/validation.ts` (moved from `src/main/types.ts:99-118`) with the behaviour and destination rules from contracts/type-definition.md. This function is the single validation point for all three write paths — create, update, and the finish gate.

**Checkpoint**: All of P1–P3 functional and independently testable.

---

## Phase 6: User Story 4 - Extending the assistant with skills and connectors (Priority: P4)

**Goal**: Skills and tool servers become usable by agent sessions, granted per type, with
confined operations receiving nothing and remote changes requiring per-change confirmation.

**Independent Test**: With a scripted tool double, verify a granted session can use the tool,
an ungranted one cannot, and a confined operation cannot even when its type is granted.

### Tests for User Story 4

- [X] T047 [P] [US4] `test/grants.test.ts` — grant resolution: a type's grants reach an interactive session; a type with no grant gets none; a confined build returns `NO_GRANT` **unconditionally** (FR-019, FR-020, SC-006).
- [X] T048 [US4] `test/grants.test.ts` — conformance over every confined purpose (ingest, polish, suggestions): each yields no grant even when the type declares one. Assert it for a misconfigured type too, since the guarantee must be architectural rather than convention-driven.
- [X] T049 [P] [US4] `test/egress.test.ts` — the egress boundary (FR-029, SC-010): for a granted type the session context excludes notes, minutes, drafts, the wiki, and other tasks; for an ungranted type the context is today's full context, **unchanged**.
- [X] T050 [US4] `test/grants.test.ts` — remote changes: a proposal produces no remote call; confirming applies exactly that change; an unconfirmed conversational request never reaches the remote (FR-023, SC-005). Assert structurally that the mutator is absent from the tool surface exposed to the model.
- [X] T051 [US4] `test/grants.test.ts` — **live read (FR-021)**: with the scripted tool double returning a value that **differs** from the task's pasted content, assert the assistant reports the live value, proving it read from the source rather than echoing `inputs`. Nothing else covers FR-021 — T050 covers writing, T047 covers grant resolution.
- [X] T052 [US4] `test/grants.test.ts` — **failure reporting (FR-024)**: an unreachable tool server and a failed remote operation each surface a failure to the user and are **never** reported as success. quickstart.md S4 case #9 states the expectation but nothing implements or verifies it.

### Implementation for User Story 4

- [X] T053 [US4] Implement grant resolution at the session-build seam in `src/main/adapters/agent/sessionFactory.ts` (currently `src/main/ai/session-factory.ts:51-91`), where the code already documents this as the intended landing spot (`:8-12`). Confinement is a property of the call site, not the caller's intent.
- [X] T054 [US4] Make the context builder grant-aware in `src/core/services/` (from `src/main/index.ts:72-92`): when a type has any grant, exclude working content and include only declared inputs and the user's request. Enforcement belongs here, not at the tool boundary — the model would already have seen the content.
- [X] T055 [US4] Implement the propose/confirm split per contracts/plugin-grants.md §4 in `src/core/domain/grant.ts` and `src/main/adapters/agent/mcpAdapter.ts`: a proposal tool exposed to the model, and a mutator reachable only from the application after a per-change confirmation. Do not rely on prompt instruction — make the mutating operation unreachable. Include the failure-reporting path required by FR-024.
- [X] T056 [US4] Wire native skill loading through the SDK (`loadSkills` / `loadSkillsFromDir`), pointing at `<userData>/skills` where `src/main/skills.ts:32-45` already copies imported folders. Note in the code that skill frontmatter `allowed-tools` is **not enforced** by the SDK, so a skill is a capability and never a permission.
- [X] T057 [US4] Add the grants UI to the type editor in `src/renderer/src/components/overlays/SettingsView.tsx`, distinguishing a skill from a tool server and stating the consequence plainly: granting external reach also means granted sessions no longer see the user's notes and minutes (contracts/plugin-grants.md §6).
- [X] T058 [US4] Add a confirmation affordance in `src/renderer/src/components/focus/` for a proposed remote change, showing exactly what will be sent before it is sent.

**Checkpoint**: All four user stories functional.

---

## Phase 7: MCP Tool-Server Integration (US4, verification-gated)

**Purpose**: Adopt the community adapter. **This phase is gated** — every task below must
pass before the tool-server half of FR-018 is claimed (research R7, plan Complexity Tracking).

> ### OUTCOME (2026-09-22, `add-mcp-support`): the deferral was lifted and T059/T060 are DONE
>
> `pi-mcp-adapter@2.33.0` was correctly deferred in September — its MCP dependencies pinned
> `pkg.pr.new` preview URLs (T061 FAIL). **`pi-mcp-adapter@2.35.0` clears the same gate**:
> `@modelcontextprotocol/client` and `@modelcontextprotocol/core` are published npm `2.0.0`,
> `fs-native-extensions` is gone, and a clean install from the project mirror writes no
> preview URL to the lockfile. So:
>
> - **T059/T060 DONE** — the adapter is adopted (pinned `2.35.0`) and wrapped at the seam
>   `src/main/adapters/agent/mcpAdapter.ts`, driven through the in-memory isolated
>   `createMcpAdapter({ config })` form (the only reference to the package anywhere in `src`,
>   enforced by `test/mcpAdapter.test.ts`).
> - **T061 re-run: PASSED on Linux**, and now **re-asserted on every test run** (exact-pin +
>   zero-`pkg.pr.new` in the lockfile), so a future dependency bump cannot silently reopen
>   it. The Windows half of the install remains unexercised — a recorded limitation (T062).
> - **T062 half-passed**: `@napi-rs/keyring` (the sole remaining native module) loads lazily
>   on Linux via asar-unpack; Windows is NOT run. **T063 satisfied**: `pi-tui` pinned at the
>   root to resolve the peer, imported by nothing. **T064 held**: the app never calls
>   OAuth/keyring; the isolated-config mode also disables the adapter's own auth UI.
> - **T065 extended** to cover the live seam: grant-filtered in-memory snapshot, confined
>   non-construction, `session_shutdown` teardown, and the no-static-import rule.
>
> The transport reaches **interactive** sessions only; confined jobs construct no adapter.
> Because the app still has no user-facing interactive-session surface, the loop is proven
> at the seam and by a scripted harness (`test/mcpRuntime.test.ts`), not a screen —
> FR-021/FR-022's second amendments keep that honest. The 2.33.0 outcome below is kept
> verbatim: it is the evidence for why the gate exists and why T061 is now a standing test.

> ### OUTCOME: the gates were run and the tool-server half was DEFERRED
>
> **T061 failed on its stated criterion.** `pi-mcp-adapter@2.33.0` pins
> `@modelcontextprotocol/client` and `@modelcontextprotocol/core` to
> `pkg.pr.new` **preview commit URLs** rather than published npm versions — the exact
> disqualifier R7 named, and for packages that do have ordinary releases (`2.0.0`). The
> URLs are reachable today (HTTP 200), which is not the question the gate asks: preview
> artifacts are per-commit, garbage-collected, and outside npm's provenance pipeline.
> T062 (both-platform native builds) could not be run — only Linux was available, and an
> unexercised platform is a recorded limitation rather than a pass. T063 and T064 could
> not be completed without installing the package.
>
> The R7a fallback was therefore invoked: **T059-T064 are not done, and T066 executed.**
> FR-018 is amended in `spec.md`, the decision and its evidence are in `research.md` R7a,
> and the grant seam, confinement guarantee, egress boundary and propose/confirm model
> ship and are tested against a scripted tool double.
>
> T065 was **adapted** rather than dropped: with no adapter to test, it became a
> structural guard on the isolation property the adoption rested on — no global MCP
> config path read or written, nothing reaching `~/.pi`, all agent state under userData —
> so the property cannot be lost before the transport lands.

- [X] T059 [US4] **DONE (2.35.0)** — Adopt `pi-mcp-adapter`, **pinned to an exact version** (`2.35.0`), consistent with the existing rule that the agent runtime is pinned and never floated. Wrapped in `src/main/adapters/agent/mcpAdapter.ts` so all adapter usage stays behind one seam.
- [X] T060 [US4] **DONE (2.35.0)** — Driven through `createMcpAdapter({ config })` with an **isolated in-memory config** built from `Settings.mcpServers`. The in-memory form is non-negotiable: it is what prevents the adapter from reading or writing the user's `~/.pi` or any global MCP config file, preserving the rule that all agent-runtime state lives under the app's user data directory. Enforced by the seam-only-import + no-`configPath` guard in `test/mcpAdapter.test.ts`.
- [X] T061 [US4] **Gate — dependency reproducibility. RE-RUN 2026-09-22: PASSED** on `2.35.0` (its `@modelcontextprotocol/client` and `@modelcontextprotocol/core` are published npm `2.0.0`; `fs-native-extensions` dropped) — and now a **standing test**: `test/mcpAdapter.test.ts` fails if the pin moves off the exact version or any `pkg.pr.new` URL enters the lockfile. The Windows half of the install is still unexercised (see T062). The original 2.33.0 FAILED result is preserved in the OUTCOME note above.
- [ ] T062 [US4] **Gate — native modules. HALF-RUN**: only `@napi-rs/keyring` remains (2.35.0 dropped `fs-native-extensions`); verified to load lazily on Linux via asar-unpack, **not** run on Windows — recorded as a limitation, not a pass. The Linux secret-service requirement must still be documented alongside the existing packaging prerequisites (GTK/NSS/ALSA) in `README.md`.
- [X] T063 [US4] **Gate — terminal-UI peer. RUN: SATISFIED** — `@earendil-works/pi-tui` is pinned at the root purely to resolve the peer; no module imports or renders a terminal, and the isolated-config mode keeps the adapter's own TUI setup commands unavailable.
- [X] T064 [US4] **Gate — credential containment. HELD** — the app never invokes OAuth/keyring code; those act only inside user-pasted server config at the user's own instruction, the isolated-config form disables the adapter's ambient auth UI, and no credential material is written to the repository, settings, or the activity record.
- [X] T065 [P] [US4] *(adapted — the adapter is deferred, so this is an isolation guard, not an adapter test)* `test/mcpAdapter.test.ts` — assert the adapter is constructed with the in-memory config, that no global MCP config path is read or written, and that nothing reaches `~/.pi`. This is the isolation property the whole adoption rests on; T061–T064 are manual gates, not tests, and a regression here would silently reintroduce global-config reads.
- [X] T066 [US4] **Fallback — INVOKED**: defer the tool-server half, keep the grant seam (T053–T058 all stand alone and are testable against a scripted tool double), and **amend FR-018 in `specs/001-extensible-type-workflows/spec.md`** rather than leaving the spec claiming unbuilt behaviour. Record the decision and the reason in `specs/001-extensible-type-workflows/research.md` R7a.

**Checkpoint**: Either the tool-server half genuinely works on both platforms, or the spec
honestly says it is not built yet.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T067 Handle a removed declared field on a built-in type. Follow the v4 precedent that strips the removed `link` field from every task's stored `inputs` and from the affected type schemas (`src/main/db.ts:515-544`), so removing a field cannot leave tasks that fail validation with `unknown input "..."` on their next write. Add the corresponding migration step and a test in `test/core.test.ts`.
- [X] T068 [P] Update `README.md`: the new Meeting type, per-type destinations, user-defined types, grants, and — if T062 ran — the Linux secret-service prerequisite.
- [X] T069 [P] Update `CLAUDE.md` for the new layering: the `src/core/` boundary and its import rule, the ports/adapters split, the four finish behaviours replacing the category dispatch, and where the MCP adapter sits. This document is the entry point for future work and currently describes the pre-refactor layout.
- [X] T070 [P] Cross-platform validation per quickstart.md S9: `npm test` and `npm run build` on Windows and Linux. Record any platform limitation explicitly — an unrecorded gap is a failing gate, not an unknown.
- [X] T071 Run the full validation in `specs/001-extensible-type-workflows/quickstart.md` S0–S9 end to end and record the outcome of each scenario.
- [X] T072 [P] Re-run `npm test` and `npm run typecheck`, and compare against the T001 baseline. Both must pass with no new failures and no skipped tests (Principle IV: a skipped test is a failure, not a pass).
- [X] T073 Confirm the layering gate holds: no `electron`, `node:*`, or DOM import under `src/core/`, nothing under `src/renderer/` importing `src/main/`, and platform APIs confined to `src/main/adapters/` (contracts/app-client.md §2).
- [X] T074 Update `specs/001-extensible-type-workflows/spec.md` status to reflect what actually shipped, including any amendment from T066. Constitution gate 6: specs stay current in the same change as the code.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup; **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational (needs the schema, the destination mechanism, and the core layer)
- **US2 (Phase 4)**: depends on Foundational. Independent of US1, but US1 is what produces artifacts to retarget, so US1 first is natural
- **US3 (Phase 5)**: depends on Foundational and on US2's destination field (a custom type declares a destination)
- **US4 (Phase 6)**: depends on Foundational. Grants are declared on a type, so the type fields from Phase 2 must exist. Otherwise independent of US1–US3
- **MCP (Phase 7)**: depends on US4's grant seam
- **Polish (Phase 8)**: depends on all desired stories

### Cross-story dependencies

- **US1 → Foundational**: T012–T016 (destination mechanism) and T009–T010 (schema) block T028–T034
- **US2 → US1**: shares `test/destination.test.ts`; T038 must not break T039's verification
- **US3 → US2**: the destination field exposed in T037 is what T045 lets a custom type declare
- **US4 → Foundational**: needs `grants` on the type from T007; otherwise standalone

### Within each story

- Tests first, and confirm they fail before implementing
- Domain before services before transport before UI
- Story complete before moving to the next priority
- **T039 runs after T038** — it verifies the change T038 makes, so it cannot precede it
- **T027 is a test and sits with the other US1 tests**, before the implementation tasks

### Parallel opportunities

- T004, T006, T011, T013, T015, T019, T036, T042, T047, T049, T065 share no files
- Within US1: T021, T024, T025 are independent — T022 and T023 share `test/finish.test.ts` with T021, and T026 and T027 are separate files
- Within US4: T047 and T049 are independent — T048, T050, T051, T052 share `test/grants.test.ts` with T047
- T068, T069, T070, T072 are independent polish tasks

**Cross-phase file sharing is not a collision**: T013 and T024 both write
`test/destination.test.ts`, but T013 is in the Foundational phase, which blocks every user
story — Phase 3 cannot begin until Phase 2 is complete, so the two are never concurrent.
The same is *not* true across user stories: US2 and US3 may run in parallel, which is why
T042 (sharing `test/types.test.ts` with T036) is deliberately not `[P]`.

---

## Parallel Example: User Story 1

```bash
# Tests first — the three disjoint ones can be written together:
Task: "test/finish.test.ts — the four behaviours"
Task: "test/destination.test.ts — collision handling"
Task: "test/e2e.test.ts — the meeting journey"
# Then, sequentially within their shared files:
Task: "test/finish.test.ts — the polish bound (FR-009, SC-011)"
Task: "test/finish.test.ts — degradation without a provider"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 Setup — **capture the baseline (T001) before anything else**
2. Phase 2 Foundational — the blocking prerequisite; expect this to be the largest phase
3. Phase 3 US1 — the Meeting workflow
4. **STOP and VALIDATE**: run quickstart.md S1 independently
5. This is a genuinely shippable increment: a new type, a new destination kind, and the
   layering that makes both extensible

### Incremental delivery

- After Phase 2 + US1: Meeting workflow, and the architecture is in place
- After US2: destinations are user-controllable; Learning is re-expressed with behaviour
  provably unchanged (T039)
- After US3: users extend the product without code
- After US4: grants and confinement — **P1–P3 remain shippable if Phase 7's gates fail**,
  which is exactly why US4 is last and Phase 7 is separable

---

## Notes

- `[P]` marks different files with no dependencies
- **Do not edit existing tests.** SC-003's whole value is that the learning tests pass
  unmodified; editing them to accommodate a change destroys the proof
- **Two hazards get dedicated tasks** because they fail silently: T032 (the snapshot walk
  makes a new destination invisible to the audit trail) and T027 (an unrecognised category
  degrades to plain behaviour instead of erroring)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently

---

## Phase 9: Convergence

Appended by `/speckit-converge` after the Phase 1-8 implementation. Each task traces to the
source it comes from. Existing tasks above are untouched — in particular T059, T060,
T062-T064 remain open in Phase 7 by documented decision (T066 invoked the R7a fallback and
FR-018 was amended), so they are not re-appended here.

- [X] T075 CRITICAL — Add test coverage for the logic-bearing modules that have none, per Constitution IV (missing): `src/core/domain/workingArea.ts` (assert `workingAreaFor` for all four categories, `finishActionLabel` for all four behaviours plus the null case, and `emptyContentWarning`) and `src/main/adapters/artifacts/index.ts` (assert `artifactStoreFor` returns the wiki store for `store: 'wiki'` and the folder store for `store: 'folder'`). Both contain branching logic and currently have zero test references. Put them in `test/workingArea.test.ts` and extend `test/artifactStore.test.ts`. Also decide explicitly whether the pure predicates in `src/core/domain/categories.ts` and `src/core/domain/config.ts` count as "logic containing" under Principle IV, and either test or record the reasoning.
- [X] T076 HIGH — Route the chat context builder through a per-category registry, per FR-007 + Constitution III + contracts/app-client.md §2 (contradicts): `fullChatContext` (`src/main/index.ts:104-117`) still branches on `kind === 'learning'` / `kind === 'jira'`, so a **meeting** task's chat silently omits its own Objective (`target`) and Prompt (`purpose`) — the same silent-degradation class quickstart S7 exists to catch, which S7 does not cover because it tests routing rather than context. Mirror the pattern already used for pre-processing: a per-category context instruction in `src/core/domain/preprocess.ts` (or a sibling module), with a test asserting a meeting task's context contains its objective — and, as with `hasPreprocess('plain')`, that a category with no entry is distinguishable from one whose entry was lost.
- [X] T077 HIGH — Amend FR-021 and FR-022 in `spec.md` to reflect the deferred transport, per FR-021 + FR-022 (partial): only FR-018 carries the amendment, yet FR-021 ("the assistant MUST be able to read current information about the referenced external item") and FR-022 ("MUST report the outcome once it is performed") both depend on the same deferred connection. Cross-reference the FR-018 note or restate both so the spec does not claim capability that is not built. FR-024 is satisfiable and satisfied — the confirmation path reports "no tool-server transport is connected" rather than success — so it needs no change.
- [X] T078 MEDIUM — Resolve the per-task `skill`/`mcp` placeholders against per-type grants, per FR-019 + contracts/plugin-grants.md §1 (contradicts): all three built-in input schemas still declare `{ key: 'skill', optionsSource: 'skills', inert: true }` and the matching `mcp` field (`src/main/db.ts:163-164`, `:183-184`, `:206-207`), rendered "not yet active". Grants are "declared on the type, not on the task", so a per-task skill selector now duplicates a working mechanism and its label is untrue of the product. Remove the fields (migration v6's `reconcileInputsForType` already strips now-undeclared inputs from tasks, and the same v4-style strip applies to any custom type schema that copied them) or, if they are deliberately retained as future per-task overrides, relabel them and say so in the spec.
- [X] T079 MEDIUM — Move the pre-processing workflow guards out of the transport, per plan §5 + contracts/app-client.md §5 (partial): `runPreprocess` (`src/main/index.ts:340-346`) decides "this category has no pre-process" and "the AI is not configured" inline. The plan states the composition root "owns no workflow logic and no domain rules". Extract into `src/core/services/preprocessService.ts` as a guard-and-enqueue use case over `StoragePort`, returning the decision the handler then acts on — the same shape already used by `taskService.setMyDay`.
- [X] T080 MEDIUM — Reconcile the plan's named structure with the layout actually in place, per plan: project structure + T053 (partial): `src/main/jobs/`, `src/main/transport/ipc.ts`, `src/main/adapters/sqlite/db.ts` and `src/main/adapters/agent/{runtime,sessionFactory}.ts` do not exist, and T053's named session-factory move was implemented as a sibling `sessionAdapter.ts` (the original path is retained deliberately: `test/e2e.test.ts` imports `setSessionFactory` from it, and T020/T039 forbid editing those tests). Either create the named structure and move the files (keeping re-export shims at the old paths so the protected tests keep passing), or update `plan.md`'s Project Structure section to describe what was built and why. There is no `polish` job handler either, because polishing runs inside the finish; record that deviation too.
- [X] T081 LOW — Remove the six exports that nothing uses, per (unrequested): `posixPathPort` (`src/main/adapters/paths.ts`), `CATEGORY_SQL_LIST`, `MARKDOWN_CATEGORIES`, `PREPROCESSING_CATEGORIES` (`src/core/domain/categories.ts`), `WRITING_BEHAVIOURS` (re-exported by `finishService`) and `grantsOf` (`src/core/domain/taskType.ts`). Each has zero references outside its own declaration. `WRITING_BEHAVIOURS` in particular duplicates the `writesArtifact()` predicate, which is the function actually used — one of the two should go rather than both existing.
