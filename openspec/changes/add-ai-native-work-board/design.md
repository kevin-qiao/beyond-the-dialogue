# Design: AI-Native Work Board

## Context

Greenfield desktop app. The full exploration history is in the conversation; the settled constraints:

- Desktop only (Windows/macOS/Linux), no mobile ever — Electron is acceptable and preferred.
- The app must be AI-native: an embedded agent runtime (Pi coding agent SDK) is the engine for all AI features, not sprinkled API calls and not an external CLI.
- LLM-WiKi integration must be invisible to the user (no plan/apply UX, no git in v1); the wiki is a directory of markdown the app owns and scaffolds.
- User configures provider/model/key and wiki location in settings; no accounts, no sync.

See proposal.md for scope and the four specs for behavioral contracts.

## Goals / Non-Goals

**Goals:**

- One embedded agent runtime serving three job kinds: paper analysis, My Day suggestions, wiki ingestion.
- Deterministic I/O (fetch, PDF extraction) stays in code; agent judgment reserved for synthesis and wiki maintenance.
- Learning artifacts are plain markdown/PDF files from birth, so ingestion is file moves + agent calls, never a DB export.
- Strict tool scoping per job — especially no shell for wiki jobs.

**Non-Goals:**

- Mobile clients, sync, accounts, multi-user.
- Git versioning of the wiki (v1 uses a history file instead).
- Other enrichment types (book/course/codebase) — only the registry seam ships.
- Wiki query/lint features, Obsidian plugin interop, user-editable schemas.
- Auto-populating My Day.

## Decisions

### D1. Electron over Tauri

Electron main process is Node, and Pi SDK is an npm TypeScript package designed for in-process embedding. Tauri's advantage (mobile path) is irrelevant — user has explicitly ruled out mobile — and embedding Pi inside a Rust-hosted sidecar would add IPC complexity for nothing. Alternatives considered: Tauri 2 (rejected: no mobile need, Pi embedding uglier), shelling out to agent CLIs (rejected: external dependency, no type safety, credentials friction).

### D2. Pi SDK in-process, one shared `ModelRuntime`, isolated in-memory sessions

- `createAgentSession()` per job with `SessionManager.inMemory()` — no session files, no cross-talk; context injected per job.
- One shared `ModelRuntime` created with app-private paths (`authPath`, `modelsPath` inside Electron `userData`) so the app never touches the user's personal `~/.pi/agent`. Settings UI writes keys via `setRuntimeApiKey` / app-owned `auth.json`.
- Per-job system prompt via `DefaultResourceLoader` `systemPromptOverride`; per-job tool curation via `tools:` + `customTools:`.
- RPC mode (`pi --mode rpc`) rejected: designed for non-JS clients and process isolation; we are Node in-process and want types + direct state access.
- Progress: `session.subscribe()` events (`tool_execution_start/end`, deltas) forwarded over IPC to the renderer.

### D3. Job kinds and tool scoping

| Job | Session | Tools | Notes |
|---|---|---|---|
| Paper analysis | in-memory, `thinkingLevel: medium` | custom: `fetch_url`, `extract_pdf_text`; builtin: `read` (job workspace only) | Deterministic fetch/extract are app code exposed as tools |
| My Day suggestions | single prompt, no loop, `thinkingLevel: off` | none | Direct pi-ai call, cheap model preferred |
| Wiki ingestion | in-memory, `cwd` = wiki dir | builtin: `read`, `write`, `edit`, `grep`, `find`, `ls` — **no `bash`/`powershell`** | Confined to wiki dir by cwd-scoped builtins |

Rationale: agents are wasteful and unreliable at raw I/O (URL handling, PDF parsing) — code does it and hands results to the agent. Agents are good at judgment (summarization, cross-referencing, wiki conventions) — that's where the loop is. Alternatives: fully hardcoded pipeline with plain LLM calls for analysis (rejected: loses flexibility, two AI stacks to maintain); fully agentic including fetching (rejected: token cost + flakiness).

### D4. Data split: SQLite app state / file-based learning artifacts

```
<userData>/
  app.db                     SQLite: lists, tasks, enrichment_jobs, paper_analysis, ingest ledger
  settings.json              provider/model/key refs, wiki path, prefs
  vault/
    notes/<taskId>.md        reading notes — born as files
    analyses/<taskId>/       summary.md, suggestions.json
    pdfs/<taskId>.pdf
<wikiPath>/                  user-configurable; default ~/Documents/WorkBoard-Wiki
  raw/  wiki/  index.md  log.md  CLAUDE.md  .history/
```

Rationale: the wiki is markdown; artifacts that will be ingested must be markdown from birth. SQLite schema is sync-ready (UUID PKs, timestamps, `deleted_at` tombstones) though sync itself is a non-goal. Enrichment states (`idle → queued → analyzing → ready | failed`) live on the job/task records; ingestion states (`queued → running → done | failed`) on the ingestion ledger. Task registry (`plain` | `paper_reading`) is a compile-time TS registry — per-type input form, pipeline, prompts, detail panel; shared job queue/state machine/IPC is the reusable investment.

### D5. My Day = flag + timestamp on task; MS To-Do rollover

`in_my_day` boolean + `my_day_added_at`. Day rollover on first app open after date change: completed tasks unflagged; incomplete persist. No auto-suggestions (user decision).

### D6. Paper pipeline (arXiv-first)

1. Link classification: arXiv (abs/pdf/ID) → arXiv API; DOI → Crossref content negotiation; other → `citation_*` meta tags scrape.
2. Fetch PDF when openly available; pdf.js text extraction in the Electron main/worker process (scanned-PDF detection by chars/page; fallback = abstract-only or user-attached PDF).
3. Single long-context agent call with structured output schema (tldr, contributions, method, results, prerequisites, reading suggestions as JSON cards); two-pass map-reduce only if text exceeds budget.
4. Title/link mismatch → mismatch warning surfaced before results finalize (spec: analysis correctness safeguard).
5. Semantic Scholar enrichment: out of scope v1.

### D7. Invisible wiki ingestion with a deposit-first safety net

On Finish: deposit (file copy: note + summary + PDF → `raw/`, queue entry) happens synchronously first — so source material survives any later failure. Then a background ingestion job runs the agent, which reads the app-authored `CLAUDE.md`, writes the source summary page, updates `index.md` and related pages, appends to `log.md`. Before the agent runs, the app snapshots every existing file it might touch into `.history/<timestamp>/` — the no-git undo story. Failure never blocks or disturbs the user; retry from the activity view. The activity view (task, timestamp, touched files) is the only visible trace.

### D8. UI stack

React + TypeScript renderer; CodeMirror 6 source-mode markdown editor + rendered preview (raw markdown is the contract — WYSIWYG round-trip lossiness would poison wiki files); `markdown-it` preview. Task detail panel hosts: analysis cards, notes editor, Finish action. IPC: typed command/event bridge.

## Risks / Trade-offs

- [No git on the wiki: a corrupting agent edit beyond `.history` snapshots is hard to undo] → snapshot-before-write covers touched files; keep `.history` retention generous; revisit git in v2.
- [Agent ingest quality varies with provider/model] → ingestion prompt is app-authored and versioned; activity view shows touched files; user can retry with a different model in settings.
- [Pi SDK API churn (pre-1.0 style project)] → pin exact versions; isolate all Pi usage behind a thin `AgentRuntime` adapter in `core` so upgrades touch one module.
- [Electron + pdf.js + CodeMirror bundle weight] → accepted; desktop-only app, no size budget.
- [Provider-specific quirks (structured output, thinking levels) leak into prompts] → single provider abstraction via pi-ai; v1 tests against the user's configured provider, not a matrix.
- [Cost per paper analysis / ingestion (multiple agent turns)] → suggestions use no-loop single call; analysis capped (token budget, map-reduce threshold); settings show last-job token/cost usage from session stats.
- [WebKit/renderer markdown edge cases] → CodeMirror 6 + markdown-it are both proven in Electron contexts.

## Migration Plan

Greenfield — no migration. Rollback = uninstall; all state lives under `userData` and the wiki directory.

## Open Questions

- Exact SQLite driver: `better-sqlite3` (native rebuild per Electron version) vs `node:sqlite` (built-in where available) — resolve during scaffolding.
- Default wiki location per-OS conventions (Documents vs userData) — minor, resolve in implementation.
- Whether suggestion chips need a dedicated cheap-model setting separate from the main model — defer until cost is observed.
