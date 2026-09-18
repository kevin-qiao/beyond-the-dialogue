# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Beyond the Dialogue is an Electron desktop to-do app (an "AI-native work board") whose AI features are powered by an **embedded agent runtime** (the Pi coding-agent SDK, `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`, pinned exact versions). It is a **type engine**: every task carries a workflow type (built-in `plain | learning | jira | meeting`, plus user-defined types stored in a `task_types` registry), and the type **declares** what happens — its declared inputs, its AI instruction, and its **finish behaviour** (one of `complete-only | file-as-is | polish-then-file | deposit-then-curate`) together with an **output destination**. Behaviour is dispatched on those declarations, never on a hardcoded type name or a category comparison. It implements the LLM-WiKi pattern (the idea/guide is bundled at `src/main/wiki/LLM-WiKi.md` and seeded into each created wiki): finished learning notes are ingested into a user-owned markdown wiki by a confined agent. Feature behavior is specified under `specs/` using the Spec Kit workflow (`.claude/skills/speckit-*`), governed by the project constitution at `.specify/memory/constitution.md`.

## Commands

```bash
npm run dev          # electron-vite dev server + Electron
npm run build        # electron-vite build (outputs to out/)
npm run typecheck    # tsc --noEmit -p tsconfig.node.json && ... -p tsconfig.web.json
npm test             # run all tests: tsx --test test/**/*.test.ts
npm run dist         # build + electron-builder (outputs to release/)
```

**`typecheck` names both projects explicitly, and must keep doing so.** The root
`tsconfig.json` is a solution file (`"files": []` plus `references`), and `tsc --noEmit`
against a solution file compiles **nothing** — referenced projects are only built with
`-b`. It silently passed for the life of the repo while ~11 real type errors sat in the
tree. If you change this script, verify it still fails on a deliberate error.

- Tests run **headless** (node:test + tsx) — no Electron is launched, and no network/API key is needed. They import `src/main` modules directly.
- Single test file: `npx tsx --test test/core.test.ts`; filter cases with `--test-name-pattern="..."`.
- Runtime requires Node ≥ 22 (uses the built-in `node:sqlite`). `.npmrc` points at the npmmirror registry and electron mirror — leave it alone.

## Architecture

### Process layout & IPC

Standard electron-vite split: `src/main` (Node), `src/preload` (contextBridge), `src/renderer` (React 18), plus `src/shared` and `src/core` imported by all three. Layer order is `shared → core → main adapters → hosts`.

**`src/core` is the domain and application layer, and it performs no I/O.** It holds `domain/` (pure rules — `categories.ts` = the single declaration of the category and finish-behaviour sets, `destination.ts` = resolution + confinement, `finish.ts` = the four behaviours, `grant.ts` = grants + egress + propose/confirm, `chatContext.ts` = per-category chat grounding, `preprocess.ts` = the per-category pre-process registry, `validation.ts`, `taskType.ts`, `hashing.ts`, `slug.ts`, `workingArea.ts`, `plugins.ts`, `config.ts`), `i18n/` (the message catalog every layer reads — see Language below), `services/` (`finishService.ts`, `taskService.ts`, `preprocessService.ts`, `settingsService.ts`), and `ports/` (the interfaces services depend on — `storage`, `artifactStore`, `agent`, `notifier`, `clock`, `paths`). It must not import `electron`, `node:*`, or a DOM global: it is compiled into the **main** target *and* the **renderer** target, and `test/layering.test.ts` asserts the boundary mechanically (along with "renderer imports nothing from `src/main`"). If you need I/O in core, add a port and implement it under `src/main/adapters/`.

Inside the other layers modules are grouped by domain. `src/main`: `index.ts` is the composition root (it builds adapters, builds services, registers the transport); root also holds the shared machinery (`paths.ts`, `db.ts`, `tasks.ts`, `job-queue.ts`, `types.ts` = db-bound wrappers over the core domain rules, `preprocess.ts` + `suggestions.ts` = job handlers, `alarms.ts`, `plugins.ts`); `adapters/` = the port implementations (`sqlite/storageAdapter.ts`, `artifacts/` = `wikiStore.ts` + `folderStore.ts` + shared `deposit.ts`, `agent/sessionAdapter.ts`, `notifier.ts`, `paths.ts`); `ai/` = agent runtime + config + session factory + chat + triggers (the Pi-SDK seams); `wiki/` = `wiki.ts` + `vault.ts` + the `ingest` job handler. Renderer components live under feature folders: `components/board/`, `components/focus/` (AI band + notes editor + `ChatPanel` + `JiraArea` + `RemoteProposalBar`), `components/overlays/` (drawer views, command palette, welcome, Settings), `components/ui/`; renderer-only helpers live in `src/renderer/src/lib/` (e.g. `typeCatalog.ts`).

- **`src/shared/types.ts`** — every domain type (Task, List, Settings, JobRecord, IngestRecord, TaskTypeDef with its `finishBehaviour`/`destination`/`grants`, `Destination`, `PluginGrant`, AppSnapshot…). `src/shared/ipc.ts` — channel names, the `RendererApi` interface, **and the typed `AppCommands`/`AppEvents` maps**: every command's args+result and every event's payload, keyed by channel. `broadcast` in the main process is typed by `AppEvents`, so a payload that drifts from the renderer's expectation is a compile error rather than a runtime surprise on one host. **Adding a feature means touching types + IPC channels + preload + main handler + store in lockstep.**
- Main process entry `src/main/index.ts` wires everything: open DB → migrate → ensure vault → JobQueue with three registered handlers → IPC handlers → window. Handlers persist, then `broadcast()` the change event (typed); the renderer merges events into its `AppSnapshot`.
- Renderer: single `AppProvider` context in `src/renderer/src/store.tsx` holds the snapshot and subscribes to all events. Views are `my-day | list | activity | settings`.

### Persistence split (D4)

Three storage kinds, deliberately different:

1. **SQLite** (`node:sqlite`, *synchronous* `DatabaseSync`) at `<userData>/app.db` — lists, tasks (with `inputs` JSON + `preprocess_status` + `alarm_at`), `task_types` (the type registry, seeded with the **4** built-ins, each carrying `finish_behaviour`/`destination_json`/`grants_json`), `enrichment_jobs`, `task_preprocess`, `task_notes`, `suggestions`, `ingest_ledger`, `settings` (incl. the `skills`/`mcpServers` JSON arrays). Schema lives in `src/main/db.ts` (`SCHEMA` const, `migrate()` steps under `schema_migrations` — v3 is the v0.8 rebuild, **v5 adds the declared workflow and widens the category CHECK to `meeting`**, **v6 reconciles task inputs against declared schemas**, **v7 retires the per-task skill/MCP placeholder inputs**, **v8 moves the wiki location out of `settings.wikiPath` and into each wiki-destined type's `destination.rootPath`** — a value the user had configured is copied into those destinations before the row is deleted; one that was never set is deliberately NOT materialized as the old `~/Documents/WorkBoard-Wiki` default), row mappers map snake_case columns → camelCase domain types. Soft deletes via `deleted_at` tombstones.
   - **v5 rebuilds three tables** (`tasks`, `task_types`, `task_preprocess`) to widen a SQL `CHECK` — SQLite cannot `ALTER` one. The `tasks` rebuild **must** wrap the swap in `PRAGMA foreign_keys = OFF` / `finally { PRAGMA foreign_keys = ON }`: it has live child rows and the drop fails immediately otherwise. Each rebuild is gated by detecting the old constraint in `sqlite_master.sql`.
   - **Removing a declared input field requires a migration that strips it.** `validateInputs` rejects an undeclared key on *every* write, so a task left holding one cannot be edited or finished and the user sees `unknown input "..."` with no way to act on it. v4 did this by name for `link`; v6 generalized it (`reconcileInputsForType`, also called on every type save); v7 reused it to retire the per-task `skill`/`mcp` placeholders. Follow the same shape for the next one.
   - **The SQL `CHECK` literals necessarily restate the category set** (SQL cannot reference a TypeScript constant). That is the unavoidable-hardcoding case Principle VI covers, so each restatement carries a comment naming `src/core/domain/categories.ts` as the declaration it mirrors. Change one, change both.
2. **Vault files** under `<userData>/vault/` — learning artifacts are born as files: working notes `notes/<taskId>.md`. All paths come from `src/main/paths.ts` (never hardcode; `setUserDataRoot()` redirects everything for tests).
3. **The wiki** — a markdown directory the TYPE destined for it declares (there is no global wiki setting and no built-in default; a wiki-destined type with no directory is refused at Finish): `raw/` (immutable deposits), `wiki/` (agent-authored pages), `index.md`, `log.md`, `CLAUDE.md` (the **wiki schema**, app-authored from `WIKI_SCHEMA` in `src/main/wiki/wiki.ts` — distinct from this repo file), `LLM-WiKi.md` (the pattern guide, seeded create-only from the bundled `src/main/wiki/LLM-WiKi.md` template), `.history/` snapshots.

**Artifact destinations are declared per type, not fixed app-wide.** Each type carries a `Destination` (`store: 'wiki' | 'folder'`, an absolute `rootPath` — required for both stores, so `store` says what happens at write time, never where the path comes from; a blank wiki root is an incomplete config refused at Finish, a blank folder root is refused at save — and a relative `subdir`), resolved through one confinement check (`relative()` + not-`..`-prefixed + not-absolute, lifted from the wiki's learning-note resolution — there is deliberately only ONE implementation). The store is chosen by `store`: `src/main/adapters/artifacts/wikiStore.ts` (delegates to the existing wiki functions unchanged) or `folderStore.ts` (a plain folder the user owns — it **never scaffolds**, so a minutes folder is never restructured into a wiki). **Collisions never overwrite or move**: `distinctName` writes `name-2.md` alongside.

### Job queue (the core machinery)

`src/main/job-queue.ts` — `JobQueue` is a persisted, concurrency-limited executor (max from settings, default 2) over `enrichment_jobs`. Three registered kinds:

- `preprocess` (`preprocess.ts`) — dispatched through the per-category registry in `src/core/domain/preprocess.ts` (`PREPROCESS_INSTRUCTIONS`), not a `kind === 'learning' ? … : …` branch: `learning` generates a working prompt + summary + 2–3 suggestions, `jira` summarizes the pasted source, `meeting` proposes an agenda and core topics. A category with no entry (`plain`) has no pre-process. One agent session, strict JSON out, persisted in `task_preprocess` and mirrored into the `suggestions` chips. The run records `inputsHash`; re-runs while the task sits in My Day are hash-gated (`preprocessInputHash` in `src/core/domain/hashing.ts` + `shouldPreprocessOnEdit` in `ai/triggers.ts`).
- `suggestion` (`suggestions.ts`) — a single non-looping LLM call (no agent session) producing 2–3 dismissible chips; only for `plain`-kind tasks.
- `ingest` (`wiki/ingest.ts`) — hosts the `deposit-then-curate` strategy (see below).

Key behaviors: transient failures (`rate limit`, `timeout`, `5xx`, `429` — see `isTransientError`) auto-retry with exponential backoff up to 3 attempts; `requeueInterrupted()` re-enqueues stuck jobs at startup; progress/step labels are emitted as events and shown in the renderer. Pre-process/suggestion jobs fire on **first add to My Day** (the category registry decides which); the `ingest` job runs on Finish for `deposit-then-curate` types only.

### Finish (the behaviour the type declares)

`src/core/services/finishService.ts` is the ONE place a task's completion is decided. It replaced a hardcoded `effectiveKind(...) === 'learning'` branch. It dispatches on the type's **declared** `finishBehaviour` via `FINISH_STRATEGIES` (`src/core/domain/finish.ts`), and the ordering is load-bearing: **validate inputs → resolve + confine the destination → `prepare()` it → write → mark complete, clear alarm → report**. A finish that cannot succeed must fail while the task is still actionable, so nothing is marked complete until the artifact step has succeeded. `deposit-then-curate` is the exception by design: it deposits synchronously (the part that must survive), marks complete, and hands the long curating agent to the `ingest` job — which is why `runIngestJob` calls the same `depositThenCurate` strategy rather than reimplementing it.

- **`polish-then-file` is bounded, and the bound is checked**: every action item and fact the assistant reports must be traceable to the user's own words (`verifyPolish`), or the draft is refused and the user's text is filed as written. The action-items section is appended by the app, so it cannot be forgotten or merged into the prose. The honest limit is documented at `verifyPolish`: it catches *asserted* content, not a fabrication buried in undeclared prose.
- Every behaviour degrades rather than failing: no provider, or a failed assistant step, still files the user's content and reports the assistant step as failed. A finish never fails solely because AI is unavailable.

### Agent runtime seams (critical for tests)

All Pi SDK usage is isolated behind two modules:

- `src/main/ai/agent-runtime.ts` — thin adapter: one shared `ModelRuntime` with app-private `auth.json`/`models.json` under userData (never the user's `~/.pi`); `runSimplePrompt` for the no-loop suggestion call.
- `src/main/ai/session-factory.ts` — central `createJobSession()` factory building per-job in-memory agent sessions (system prompt, tools, cwd). It exposes **test seams**: `setSessionFactory()` and `setSimplePromptOverride()` replace the Pi SDK entirely with scripted sessions. `src/main/adapters/agent/sessionAdapter.ts` implements `AgentSessionPort` over it.
- `src/main/ai/chatMessages.ts` — the shape a chat history must have before the SDK sees it, and deliberately **SDK-free** so a test can pin it (`test/chatMessages.test.ts`). An assistant entry without a `usage` makes the SDK's context estimator throw *inside* the provider call, which the SDK reports as an error terminal message with no content — i.e. a chat reply that silently never appears. `streamChat` applies it at the call.

**Grants are resolved HERE, at session build, from the run's PURPOSE** (`resolveGrant` in `src/core/domain/grant.ts`). `purpose: 'confined'` returns `NO_GRANT` unconditionally — there is no code path that yields a grant for ingestion, polishing, or suggestions, so the confinement guarantee holds even for a misconfigured type. `purpose` defaults to `'confined'`, so a caller that says nothing gets the safe answer. Granted skills load through the SDK's `additionalSkillPaths`; note the SDK does **not** enforce a skill's frontmatter `allowed-tools`, so a skill is a capability and never a permission.

**Chat grounding is also a per-category registry** (`src/core/domain/chatContext.ts`), for the same reason as pre-processing: it used to be `kind === 'learning'` / `kind === 'jira'` ternaries, so adding the `meeting` category silently gave its chat *less* grounding — no objective, no focus prompt — with nothing failing. `test/chatContext.test.ts` asserts the registry is total over the categories that have a pre-process, so a category can no longer be forgotten quietly.

**The egress boundary is enforced at context CONSTRUCTION, not at the tool boundary** (`buildSessionContext` in `grant.ts`, wired into `buildChatContext` in `index.ts`). Once a session can reach an external tool, filtering at the call site is too late — the content is already in the prompt. A granted session therefore sees only the task's declared inputs and the user's request; an ungranted one sees exactly what it always saw.

**Remote changes are structurally un-makeable without confirmation.** `remoteToolSurface()` exposes only a *proposal* tool; the mutator (`RemoteMutator.apply`) is reachable only from the application after a per-change confirmation, never from the model's tool surface. Making the operation unreachable is what makes FR-023 a constraint rather than a prompt instruction. Proposals surface in `RemoteProposalBar`, which shows the literal payload before the user confirms.

Tests never contact a real provider: they inject scripted sessions (`test/e2e.test.ts` is the flagship: learning task → My Day → preprocess → notes → Finish → wiki ingest, all scripted). `ai-config.ts` (in `src/main/ai/`) is pure and importable anywhere — the renderer uses it for the "AI not configured" indicator. Keep Pi SDK usage out of any file that isn't these two.

### Wiki ingestion (D7 — deposit-first safety net)

On Finish of a learning task: synchronous file-copy of the working note (filename = title slug, deduped) + the AI pre-process summary + the optional attachment into `raw/<taskId>/` *first* (survives any later failure), then a background ingest job: snapshot every existing wiki file into `.history/<timestamp>/` → run the confined agent (tools `read|write|edit|grep|find|ls`, **no shell**, cwd = wiki dir, must follow the wiki `CLAUDE.md` workflow and write the curated note at the task's **learning-note path**, default `learning-notes/<slug>.md` under the wiki) → diff against the snapshot (`diffTouchedFiles`) to report what was actually touched in the ingest ledger (shown in the Activity view, where failed ingests can be retried). A learning-note path that no longer resolves under the current wiki is refused at Finish, never silently mis-saved (`resolveLearningNotePath`). Jira-kind tasks Finish locally only (no ingestion). Never delete or restructure the wiki scaffolding logic — scaffold is create-only.

### Language (the UI is bilingual)

Every string the app's own UI shows comes from a catalog in `src/core/i18n/` — `en.ts` is the key set, `zhCn.ts` must cover it, and the renderer reads it through `useT()` (`src/renderer/src/lib/useT.ts`), which is fed by `Settings.uiLanguage` in the store. A missing translation or a stray key is a `tsc` error, so `npm run typecheck` is the parity gate.

- **`uiLanguage` is presentation only.** It is named that way to say so: it never reaches a prompt, and the agent's output language is the model's own. The one `toLocaleString('en-US')` left in `src/main` is inside a prompt and carries a comment saying why.
- **The English values are the app's original literals, character for character.** Two things depend on it: `displayTypeLabel` and friends decide a seeded type label is still the default by comparing the stored row against `en[key]` (so a rename is never clobbered — no migration, nothing written back), and it keeps the change invisible in English. Translating a literal into a key may only turn interpolation into a `{param}` hole.
- **The domain refuses in codes, not sentences** (`src/core/i18n/issues.ts`). `src/core` has no language and is compiled into both hosts, so `validation.ts`, `destination.ts`, `plugins.ts` and the finish/pre-process services return `MessageIssue[]` / throw `LocalizedError`. Main phrases them in `handleCommand` (`src/main/index.ts`) before the throw — errors cross IPC as strings, so nothing structured survives the boundary. `localizeThrown` passes non-code errors through **by identity**, which is what keeps a transient job failure retriable.
- **Main and core thread the language as a parameter** from the call sites that already hold `Settings` — never a module global. Step labels are produced already-localised because `jobs.step_label` persists them.
- **The drift guard** (`test/i18n.test.ts` + `test/i18n-literal-baseline.json`) fails when a new user-visible literal appears outside the catalog. The baseline is now empty and the ratchet is strict; `npx tsx test/helpers/i18nBaseline.ts` regenerates it, and its diff should only ever shrink. Its census sees JSX text and the `placeholder`/`title`/`aria-label`/`alt` attributes — **not** strings passed as arguments (`notify('…')`, a `confirm({ message })`), so grep for those when adding a feature.
- **Known limits, by design:** `jobs.step_label`, `tasks.preprocess_error` and the ingest ledger keep the language they were written in — a record of what happened, in the language it happened in. The agent SDK's own step labels (tool names, "Thinking…") cannot be localised and appear in English mid-progress.

## Conventions & gotchas

- **`node:sqlite` is synchronous** — no awaits around DB calls anywhere in main.
- CamelCase domain types everywhere; only `db.ts` row mappers know the snake_case columns.
- ESM-only packages (Pi agent SDK) are loaded via dynamic `import()`; main builds to ESM (`out/main/index.mjs`) but preload stays CJS.
- Job handlers must throw with a message `isTransientError` understands for retries; use `ctx.setStep(label, progress)` for renderer progress. Pre-process/suggestion trigger on first My Day add; ingest on Finish.
- `preprocessStatus` lifecycle: `none → queued → running → ready | failed`. Re-runs while a task sits in My Day are hash-gated on *relevant* (non-inert) input changes plus title/notes; a `ready` task with unchanged inputs never re-runs on re-add.
- Behavior dispatch always goes through the type's `kind` (`effectiveKind`/`effectiveTypeDef` in `src/main/types.ts`; `typeCatalog.ts` renderer-side) — never a type key. Custom types configure built-in kinds; they never add engines in v0.8.
- Skills and MCP servers managed in Settings are **inert** in v0.8: `validatePluginEntries` (`plugins.ts`) is the only reader besides persistence. The future grant lands at the `session-factory.ts` seam and must never reach the confined ingest/suggestion paths.
- Alarms: `tasks.alarm_at` is the single source of truth; `AlarmScheduler` (`alarms.ts`) is Electron-free (the notifier is injected), firing consumes the alarm, completion cancels it.
- My Day rollover (`rolloverMyDay` in `tasks.ts`) runs on startup: completed My Day tasks clear, incomplete persist.
- The spec source of truth is `specs/` (Spec Kit: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`), and `.specify/memory/constitution.md` is the governing constitution. Update specs alongside code changes — the constitution requires it.
- Do not add git operations to the wiki in v1 — `.history/` snapshots are the undo story.
