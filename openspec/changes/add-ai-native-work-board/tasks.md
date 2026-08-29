# Tasks: AI-Native Work Board

## 1. App scaffolding

- [x] 1.1 Scaffold Electron + TypeScript project (main/preload/renderer), electron-builder config for Windows/macOS/Linux, and verify `npm run dev` opens an empty window and `npm run dist` produces an unpacked build
- [x] 1.2 Set up typed IPC bridge (commands + events) between renderer and main; verify a ping command round-trips in the running app
- [x] 1.3 Add dependencies: `@earendil-works/pi-coding-agent`, pdf.js, CodeMirror 6, markdown-it, SQLite driver; verify install and that the app bundles without native-module breakage

## 2. Data layer

- [x] 2.1 Implement SQLite schema (lists, tasks, enrichment_jobs, paper_analysis, reading_notes, ingest_ledger; UUID PKs, timestamps, deleted_at tombstones) with migrations; verify schema file applies cleanly on fresh DB
- [x] 2.2 Implement settings store (provider, model, key, wiki path, prefs) in app-private userData; verify settings persist across restart and never write outside userData
- [x] 2.3 Implement vault layout (`notes/`, `analyses/`, `pdfs/`) with file-backed note paths registered per task; verify a created note file survives app restart

## 3. Task management core (spec: task-management)

- [x] 3.1 Implement lists CRUD and navigation UI; verify create/rename/delete list with tasks behaves per spec
- [x] 3.2 Implement task CRUD, completion (struck-through, stays visible), and task-type selection (plain | paper reading); verify plain task lifecycle per spec scenarios
- [x] 3.3 Implement My Day view (manual add/remove, task stays in original list); verify add/remove scenarios per spec
- [x] 3.4 Implement day rollover on first open after date change (completed unflagged, incomplete persist); verify by mocking system date
- [x] 3.5 Implement local persistence and restart-restore of all task state; verify restart preserves lists, tasks, My Day membership, completion

## 4. AI runtime (spec: ai-runtime)

- [x] 4.1 Implement shared Pi `ModelRuntime` with app-private auth paths and runtime API keys from settings; verify configured provider/model is used by a test prompt
- [x] 4.2 Implement job queue (SQLite-backed, states queued/running/done/failed, max 2 concurrent, restart re-queue of interrupted jobs); verify with simulated jobs
- [x] 4.3 Implement per-job isolated in-memory agent sessions with per-job system prompt and tool curation; verify two concurrent jobs share no context
- [x] 4.4 Implement auto-retry with backoff for transient provider errors; verify via mocked provider errors
- [x] 4.5 Implement no-key graceful degradation (non-blocking "AI not configured" indicator, task ops unaffected); verify app fully usable with no key
- [x] 4.6 Implement progress event forwarding (session events → IPC → task-row step label) and failure containment with retry affordance; verify per-task progress during a real analysis
- [x] 4.7 Implement My Day suggestion job (single prompt, no loop, context = task + list + My Day titles + local time; 2–3 dismissible chips; never mutates task); verify chips appear, dismiss, and task unchanged

## 5. Paper-reading enrichment (spec: paper-reading)

- [x] 5.1 Implement paper-reading task creation form (name + link required) and detail panel shell; verify missing link is rejected
- [x] 5.2 Implement link resolution (arXiv API full support; DOI/Crossref and citation_* meta-tag fallback; record analysis_level); verify against real arXiv link and a paywalled link
- [x] 5.3 Implement PDF fetch and pdf.js text extraction with scanned-PDF detection and abstract-only fallback; verify extraction on an open-access arXiv PDF
- [x] 5.4 Implement custom agent tools (`fetch_url`, `extract_pdf_text`) exposing deterministic steps to the analysis agent; verify agent can complete a job using them
- [x] 5.5 Implement analysis agent (structured output: tldr, contributions, method, results, prerequisites, reading suggestions) with token-budget map-reduce fallback; verify real arXiv paper produces complete result set
- [x] 5.6 Implement My Day trigger (analysis starts on add; no re-analysis when already analyzed); verify both scenarios per spec
- [x] 5.7 Implement manual PDF attach + re-analysis upgrade clearing the abstract-only label; verify with a local PDF on a paywalled task
- [x] 5.8 Implement title/link mismatch warning flow (confirm, correct link, or attach PDF before results finalize); verify with a deliberately mismatched link
- [x] 5.9 Implement analysis results panel (summary + suggestion cards, progress view while running); verify all three UI states (running / ready / abstract-only)
- [x] 5.10 Implement markdown notes editor (CodeMirror 6 + preview, autosave to vault, usable before analysis completes); verify autosave and restart persistence

## 6. Wiki ingestion (spec: wiki-ingest)

- [x] 6.1 Implement wiki path setting with default location and validation; verify custom path is honored
- [x] 6.2 Implement wiki scaffolding (raw/, wiki/, index.md, log.md, app-authored CLAUDE.md schema) on first use; verify fresh scaffold and that existing structures are never overwritten
- [x] 6.3 Implement deposit step (note + summary + PDF → raw/ with queue entry) executed synchronously before agent runs; verify deposit survives simulated agent failure
- [x] 6.4 Implement `.history/<timestamp>/` snapshot of files about to be modified; verify prior contents are recoverable after an ingest
- [x] 6.5 Implement ingestion agent (cwd=wiki, read/write/edit/grep/find/ls only, no shell): source summary page, index update, related-page updates, log entry, following CLAUDE.md conventions; verify full ingest on a finished paper and confinement (no writes outside wiki dir)
- [x] 6.6 Implement Finish action (complete task, hand off to ingestion, immediate confirmation, empty-note warning); verify both scenarios per spec
- [x] 6.7 Implement failure handling (auto-retry, activity-view retry affordance, task unaffected); verify retry succeeds after fixing cause
- [x] 6.8 Implement activity view (ingest history: task, timestamp, touched files); verify entries appear for past ingestions

## 7. Settings UI

- [x] 7.1 Implement settings screen (provider picker, model id, API key, wiki path) wired to settings store and ModelRuntime; verify a saved config is used by the next AI job and credentials stay in userData

## 8. End-to-end validation

- [x] 8.1 Full flagship scenario test: create paper task with arXiv link → move to My Day → analysis completes → write notes → Finish → wiki ingested (raw + summary page + index + log) with zero visible wiki friction; verify each spec scenario in one run
- [x] 8.2 Failure-path test run: no API key, invalid link, paywalled paper, provider 429 mid-analysis, agent failure mid-ingest; verify every case degrades per spec and recovers
- [x] 8.3 Package distributable builds for the current platform and verify the packaged app (not dev mode) passes the flagship scenario
