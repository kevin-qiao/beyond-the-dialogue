# Proposal: AI-Native Work Board

## Why

Personal task managers capture *what* to do but do nothing with it: a "read this paper" task is just a line of text, and the learning that comes out of it evaporates into scattered notes. We want a desktop to-do app that is AI-native at its core — an embedded agent runtime (Pi) that analyzes tasks, deep-reads papers, and silently files learning notes into a personal LLM-WiKi knowledge base — so that daily planning and learning compound instead of scattering.

## What Changes

This is a greenfield application (v1). Everything is new:

- **Desktop app shell** — cross-platform Electron app (Windows, macOS, Linux); no mobile target.
- **To-do core** — task lists, task CRUD, completion, and a manual "My Day" daily planning view with MS To-Do-style day rollover (completed tasks clear next day; incomplete tasks persist).
- **AI task suggestions** — when a task enters My Day, a lightweight background LLM call produces 2–3 dismissible suggestion chips; suggestions never mutate tasks.
- **Paper-reading task type** — first instance of a pluggable "task enrichment" concept: a task with title + link triggers background analysis (arXiv-first resolution → PDF text extraction → structured summary + reading suggestions) shown in a detail panel; a markdown reading-notes editor; a "Finish" action.
- **Embedded AI agent runtime** — Pi coding agent SDK (`@earendil-works/pi-coding-agent`) embedded in the Electron main process: per-job isolated in-memory sessions, custom tools (fetch, PDF extraction), curated built-in tools (no shell for wiki work), shared `ModelRuntime` driven by user settings.
- **Settings** — user-configurable LLM provider, model, API key, and learning-space (wiki) directory location.
- **Learning-space (LLM-WiKi) integration, invisible** — the app auto-scaffolds an LLM-WiKi directory structure (raw/, wiki/, index.md, log.md, CLAUDE.md schema) on first use; on "Finish", the app deposits the note + analysis into `raw/` and an embedded agent ingests it in the background (summary page, index/entity updates, log entry). The user never sees wiki operations — only a subtle activity log in settings. No git in v1.
- **Local-first storage** — SQLite for app state (tasks, lists, job queue); learning artifacts (notes, analyses, PDFs) stored as plain markdown/PDF files in an app-owned vault directory so ingestion is file moves, not database export.

## Capabilities

### New Capabilities

- `task-management`: Task lists, task CRUD and completion, My Day manual planning view, and daily rollover semantics.
- `ai-runtime`: Embedded Pi agent runtime in the Electron main process — settings-driven provider/model/key configuration, per-job session isolation, curated tool access, background job queue with progress/retry states.
- `paper-reading`: Paper-reading task enrichment — link resolution and background analysis, summary/reading-suggestions detail panel, markdown reading-notes editor, and the Finish handoff.
- `wiki-ingest`: Auto-scaffolded LLM-WiKi learning space and invisible background ingestion of finished reading notes, with an in-app activity log.

### Modified Capabilities

(none — greenfield)

## Impact

- **New codebase**: Electron + TypeScript app; platform-neutral TS `core` package; Electron main process hosts SQLite (`better-sqlite3` or `node:sqlite`), job queue, vault/wiki file I/O, and the Pi SDK runtime.
- **Dependencies**: `@earendil-works/pi-coding-agent` / `pi-ai` (MIT), pdf.js (extraction), CodeMirror 6 + a markdown renderer (editor), SQLite driver.
- **External systems**: LLM provider APIs (user-supplied key); arXiv/Crossref/publisher HTTP endpoints; the user's local wiki directory (app-created).
- **No existing systems are modified** — greenfield, local-only, no accounts, no sync, no git in v1.
