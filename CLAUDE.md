# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Beyond the Dialogue is an Electron desktop to-do app (an "AI-native work board") whose AI features are powered by an **embedded agent runtime** (the Pi coding-agent SDK, `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`, pinned exact versions). v0.8 is a **type engine**: every task carries a workflow type (built-in `plain | learning | jira`, plus user-defined types stored in a `task_types` registry), and the type's `kind` — not hardcoded flows — decides the task's declared inputs, AI pre-process, working area, and Finish behavior. It implements the LLM-WiKi pattern (the idea/guide is bundled at `src/main/wiki/LLM-WiKi.md` and seeded into each created wiki): finished learning notes are ingested into a user-owned markdown wiki by a confined agent. The v0.8 design rationale lives in `openspec/changes/task-type-workflows/` (design.md D1–D8 + five capability specs); feature behavior is spec'd in `openspec/`.

## Commands

```bash
npm run dev          # electron-vite dev server + Electron
npm run build        # electron-vite build (outputs to out/)
npm run typecheck    # tsc --noEmit (whole repo, node + web configs)
npm test             # run all tests: tsx --test test/**/*.test.ts
npm run dist         # build + electron-builder (outputs to release/)
```

- Tests run **headless** (node:test + tsx) — no Electron is launched, and no network/API key is needed. They import `src/main` modules directly.
- Single test file: `npx tsx --test test/core.test.ts`; filter cases with `--test-name-pattern="..."`.
- Runtime requires Node ≥ 22 (uses the built-in `node:sqlite`). `.npmrc` points at the npmmirror registry and electron mirror — leave it alone.

## Architecture

### Process layout & IPC

Standard electron-vite three-layer split: `src/main` (Node), `src/preload` (contextBridge), `src/renderer` (React 18), plus `src/shared` imported by all three.

Inside those layers modules are grouped by domain, not flattened. `src/main`: root holds the wiring entry `index.ts` plus the shared machinery/state they all touch (`paths.ts`, `db.ts`, `tasks.ts`, `job-queue.ts`, `types.ts` = the type registry service incl. input validation and the pre-process input hash, `preprocess.ts` + `suggestions.ts` = job handlers, `alarms.ts` = task alarm scheduler, `plugins.ts` = skills/MCP validation); `ai/` = agent runtime + config + session factory + chat + triggers (the Pi-SDK seams); `wiki/` = `wiki.ts` + `vault.ts` + the `ingest` job handler. Renderer components live under feature folders: `components/board/` (3-column shell + task rows/forms + `TaskInputsForm` generic per-type inputs + `status`), `components/focus/` (AI band + notes editor + `ChatPanel` + `JiraArea`), `components/overlays/` (drawer views, command palette, welcome, Settings), `components/ui/` (shared primitives like `Dialog`); renderer-only helpers live in `src/renderer/src/lib/` (e.g. `typeCatalog.ts` — the single place that resolves a task's effective type/kind from the snapshot's `taskTypes`).

- **`src/shared/types.ts`** — every domain type (Task, List, Settings, JobRecord, IngestRecord, PaperAnalysis, AppSnapshot…). `src/shared/ipc.ts` — all IPC channel names plus the `RendererApi` interface. The preload implements `RendererApi`; the renderer's `window.api` is typed by it. **Adding a feature means touching types + IPC channels + preload + main handler + store in lockstep.**
- Main process entry `src/main/index.ts` wires everything: open DB → migrate → ensure vault → JobQueue with three registered handlers → IPC handlers → window. Handlers persist, then `broadcast()` the change event; the renderer merges events into its `AppSnapshot`.
- Renderer: single `AppProvider` context in `src/renderer/src/store.tsx` holds the snapshot and subscribes to all events. Views are `my-day | list | activity | settings`.

### Persistence split (D4)

Three storage kinds, deliberately different:

1. **SQLite** (`node:sqlite`, *synchronous* `DatabaseSync`) at `<userData>/app.db` — lists, tasks (with `inputs` JSON + `preprocess_status` + `alarm_at`), `task_types` (the type registry, seeded with the 3 built-ins), `enrichment_jobs`, `task_preprocess`, `task_notes`, `suggestions`, `ingest_ledger`, `settings` (incl. the inert `skills`/`mcpServers` JSON arrays). Schema lives in `src/main/db.ts` (`SCHEMA` const, `migrate()` steps under `schema_migrations` — v3 is the v0.8 rebuild), row mappers map snake_case columns → camelCase domain types. Soft deletes via `deleted_at` tombstones.
2. **Vault files** under `<userData>/vault/` — learning artifacts are born as files: working notes `notes/<taskId>.md`. All paths come from `src/main/paths.ts` (never hardcode; `setUserDataRoot()` redirects everything for tests).
3. **The wiki** — a user-configurable markdown directory (default `~/Documents/WorkBoard-Wiki`): `raw/` (immutable deposits), `wiki/` (agent-authored pages), `index.md`, `log.md`, `CLAUDE.md` (the **wiki schema**, app-authored from `WIKI_SCHEMA` in `src/main/wiki/wiki.ts` — distinct from this repo file), `LLM-WiKi.md` (the pattern guide, seeded create-only from the bundled `src/main/wiki/LLM-WiKi.md` template), `.history/` snapshots.

### Job queue (the core machinery)

`src/main/job-queue.ts` — `JobQueue` is a persisted, concurrency-limited executor (max from settings, default 2) over `enrichment_jobs`. Three registered kinds:

- `preprocess` (`preprocess.ts`) — dispatched by the task's effective kind: `learning` generates a working prompt + summary + 2–3 activity suggestions from the task's own text (never fetches links/files); `jira` summarizes the pasted source content (issue status / page quality per `sourceKind`). One agent session, strict JSON out, persisted in `task_preprocess` and mirrored into the `suggestions` chips. The run records `inputsHash`; re-runs while the task sits in My Day are hash-gated (`preprocessInputHash` in `types.ts` + `shouldPreprocessOnEdit` in `ai/triggers.ts`).
- `suggestion` (`suggestions.ts`) — a single non-looping LLM call (no agent session) producing 2–3 dismissible chips; only for `plain`-kind tasks.
- `ingest` (`wiki/ingest.ts`) — wiki ingestion (see below).

Key behaviors: transient failures (`rate limit`, `timeout`, `5xx`, `429` — see `isTransientError`) auto-retry with exponential backoff up to 3 attempts; `requeueInterrupted()` re-enqueues stuck jobs at startup; progress/step labels are emitted as events and shown in the renderer. Pre-process/suggestion jobs fire on **first add to My Day** (kind decides which); ingest on Finish (learning kind only).

### Agent runtime seams (critical for tests)

All Pi SDK usage is isolated behind two modules:

- `src/main/ai/agent-runtime.ts` — thin adapter: one shared `ModelRuntime` with app-private `auth.json`/`models.json` under userData (never the user's `~/.pi`); `runSimplePrompt` for the no-loop suggestion call.
- `src/main/ai/session-factory.ts` — central `createJobSession()` factory building per-job in-memory agent sessions (system prompt, tools, cwd). It exposes **test seams**: `setSessionFactory()` and `setSimplePromptOverride()` replace the Pi SDK entirely with scripted sessions.

Tests never contact a real provider: they inject scripted sessions (`test/e2e.test.ts` is the flagship: learning task → My Day → preprocess → notes → Finish → wiki ingest, all scripted). `ai-config.ts` (in `src/main/ai/`) is pure and importable anywhere — the renderer uses it for the "AI not configured" indicator. Keep Pi SDK usage out of any file that isn't these two.

### Wiki ingestion (D7 — deposit-first safety net)

On Finish of a learning task: synchronous file-copy of the working note (filename = title slug, deduped) + the AI pre-process summary + the optional attachment into `raw/<taskId>/` *first* (survives any later failure), then a background ingest job: snapshot every existing wiki file into `.history/<timestamp>/` → run the confined agent (tools `read|write|edit|grep|find|ls`, **no shell**, cwd = wiki dir, must follow the wiki `CLAUDE.md` workflow and write the curated note at the task's **learning-note path**, default `learning-notes/<slug>.md` under the wiki) → diff against the snapshot (`diffTouchedFiles`) to report what was actually touched in the ingest ledger (shown in the Activity view, where failed ingests can be retried). A learning-note path that no longer resolves under the current wiki is refused at Finish, never silently mis-saved (`resolveLearningNotePath`). Jira-kind tasks Finish locally only (no ingestion). Never delete or restructure the wiki scaffolding logic — scaffold is create-only.

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
- The `openspec/` directory is the spec source of truth (OpenSpec workflow — see `.claude/skills/openspec-*`); update specs there alongside code changes.
- Do not add git operations to the wiki in v1 — `.history/` snapshots are the undo story.
