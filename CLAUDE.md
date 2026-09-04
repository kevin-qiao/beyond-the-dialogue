# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Work Board is an Electron desktop to-do app ("AI-Native Work Board") whose AI features are powered by an **embedded agent runtime** (the Pi coding-agent SDK, `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai`, pinned exact versions). It implements the LLM-WiKi pattern (the idea/guide is bundled at `src/main/wiki/LLM-WiKi.md` and seeded into each created wiki): finished paper-reading tasks are ingested into a user-owned markdown wiki by a confined agent. The full design rationale lives in `openspec/changes/add-ai-native-work-board/design.md` (D1–D8) and the four specs under `openspec/changes/add-ai-native-work-board/specs/`; feature behavior is spec'd there.

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

Inside those layers modules are grouped by domain, not flattened. `src/main`: root holds the wiring entry `index.ts` plus the shared machinery/state they all touch (`paths.ts`, `db.ts`, `tasks.ts`, `job-queue.ts`, `suggestions.ts`); `ai/` = agent runtime + config + session factory + chat + triggers (the Pi-SDK seams); `wiki/` = `wiki.ts` + `vault.ts` + the `ingest` job handler; `paper/` = `resolve.ts` + `pdf.ts` + the `analysis` job handler. Renderer components live under feature folders: `components/board/` (3-column shell + task rows/forms + `status`), `components/focus/` (AI band + notes editor), `components/overlays/` (drawer views, command palette, welcome), `components/ui/` (shared primitives like `Dialog`); renderer-only helpers live in `src/renderer/src/lib/` (e.g. `typeCatalog.ts`).

- **`src/shared/types.ts`** — every domain type (Task, List, Settings, JobRecord, IngestRecord, PaperAnalysis, AppSnapshot…). `src/shared/ipc.ts` — all IPC channel names plus the `RendererApi` interface. The preload implements `RendererApi`; the renderer's `window.api` is typed by it. **Adding a feature means touching types + IPC channels + preload + main handler + store in lockstep.**
- Main process entry `src/main/index.ts` wires everything: open DB → migrate → ensure vault → JobQueue with three registered handlers → IPC handlers → window. Handlers persist, then `broadcast()` the change event; the renderer merges events into its `AppSnapshot`.
- Renderer: single `AppProvider` context in `src/renderer/src/store.tsx` holds the snapshot and subscribes to all events. Views are `my-day | list | activity | settings`.

### Persistence split (D4)

Three storage kinds, deliberately different:

1. **SQLite** (`node:sqlite`, *synchronous* `DatabaseSync`) at `<userData>/app.db` — lists, tasks, `enrichment_jobs`, `paper_analysis`, `reading_notes`, `suggestions`, `ingest_ledger`, `settings`. Schema lives in `src/main/db.ts` (`SCHEMA` const, row mappers map snake_case columns → camelCase domain types). Soft deletes via `deleted_at` tombstones.
2. **Vault files** under `<userData>/vault/` — learning artifacts are born as files: `notes/<taskId>.md`, `analyses/<taskId>/{summary.md,suggestions.json,workspace/}`, `pdfs/<taskId>.pdf`. All paths come from `src/main/paths.ts` (never hardcode; `setUserDataRoot()` redirects everything for tests).
3. **The wiki** — a user-configurable markdown directory (default `~/Documents/WorkBoard-Wiki`): `raw/` (immutable deposits), `wiki/` (agent-authored pages), `index.md`, `log.md`, `CLAUDE.md` (the **wiki schema**, app-authored from `WIKI_SCHEMA` in `src/main/wiki/wiki.ts` — distinct from this repo file), `LLM-WiKi.md` (the pattern guide, seeded create-only from the bundled `src/main/wiki/LLM-WiKi.md` template), `.history/` snapshots.

### Job queue (the core machinery)

`src/main/job-queue.ts` — `JobQueue` is a persisted, concurrency-limited executor (max from settings, default 2) over `enrichment_jobs`. Three registered kinds:

- `analysis` (`paper/analysis.ts`) — resolve link (arXiv API / DOI Crossref / `citation_*` meta tags, in `paper/resolve.ts`), get paper text (attached PDF → pdf.js extraction with scanned detection → open-access PDF fetch → abstract fallback), then one agent session producing a strict JSON object (tldr/contributions/method/results/prerequisites/suggestions). Title-vs-resolved-title mismatch sets `mismatchState: warning`.
- `suggestion` (`suggestions.ts`, at `src/main` root) — a single non-looping LLM call (no agent session) producing 2–3 dismissible chips.
- `ingest` (`wiki/ingest.ts`) — wiki ingestion (see below).

Key behaviors: transient failures (`rate limit`, `timeout`, `5xx`, `429` — see `isTransientError`) auto-retry with exponential backoff up to 3 attempts; `requeueInterrupted()` re-enqueues stuck jobs at startup; progress/step labels are emitted as events and shown in the renderer. Analysis/suggestion jobs are triggered on adding a task to My Day; ingest on Finish.

### Agent runtime seams (critical for tests)

All Pi SDK usage is isolated behind two modules:

- `src/main/ai/agent-runtime.ts` — thin adapter: one shared `ModelRuntime` with app-private `auth.json`/`models.json` under userData (never the user's `~/.pi`); `runSimplePrompt` for the no-loop suggestion call.
- `src/main/ai/session-factory.ts` — central `createJobSession()` factory building per-job in-memory agent sessions (system prompt, tools, cwd). It exposes **test seams**: `setSessionFactory()` and `setSimplePromptOverride()` replace the Pi SDK entirely with scripted sessions.

Tests never contact a real provider: they inject scripted sessions (`test/e2e.test.ts` is the flagship: arXiv task → My Day → analysis → notes → Finish → wiki ingest, all scripted). `ai-config.ts` (in `src/main/ai/`) is pure and importable anywhere — the renderer uses it for the "AI not configured" indicator. Keep Pi SDK usage out of any file that isn't these two.

### Wiki ingestion (D7 — deposit-first safety net)

On Finish: synchronous file-copy of note + summary + PDF into `raw/<taskId>/` *first* (survives any later failure), then a background ingest job: snapshot every existing wiki file into `.history/<timestamp>/` → run the confined agent (tools `read|write|edit|grep|find|ls`, **no shell**, cwd = wiki dir, must follow the wiki `CLAUDE.md` workflow) → diff against the snapshot (`diffTouchedFiles`) to report what was actually touched in the ingest ledger (shown in the Activity view, where failed ingests can be retried). Never delete or restructure the wiki scaffolding logic — scaffold is create-only.

## Conventions & gotchas

- **`node:sqlite` is synchronous** — no awaits around DB calls anywhere in main.
- CamelCase domain types everywhere; only `db.ts` row mappers know the snake_case columns.
- ESM-only packages (pdf.js v4, Pi agent SDK) are loaded via dynamic `import()`; main builds to ESM (`out/main/index.mjs`) but preload stays CJS.
- Job handlers must throw with a message `isTransientError` understands for retries; use `ctx.setStep(label, progress)` for renderer progress.
- `analysisStatus` lifecycle: `none → queued → running → ready | abstract_only | failed`; `abstract_only` when only the abstract was available. Re-analysis is gated so `ready`/`abstract_only` tasks never re-run on My Day re-add.
- My Day rollover (`rolloverMyDay` in `tasks.ts`) runs on startup: completed My Day tasks clear, incomplete persist.
- The `openspec/` directory is the spec source of truth (OpenSpec workflow — see `.claude/skills/openspec-*`); update specs there alongside code changes.
- Do not add git operations to the wiki in v1 — `.history/` snapshots are the undo story.
