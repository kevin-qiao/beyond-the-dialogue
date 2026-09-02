# Work Board v2 — Architecture design

> Status: **proposed** (exploration, not yet implemented)
> Date: 2026-09-02
> Visual: component diagram in [`docs/architecture.drawio`](architecture.drawio) (open in draw.io)
> Scope: two sequential changes — `refine-board-ux` (renderer shell) then `task-types-work-area` (domain + agent machinery). See §10.

## 0. Design goals & constraints honored

The v2 spine: **a user-visible type catalog that drives agent behavior, inside a board-style three-column shell**. It must respect v1's architecture laws:

1. **SQLite (sync) owns structured state**; the **vault owns artifacts**; the **wiki stays user-owned markdown** — nothing changes about the split.
2. **All agent access goes through the two seams** (`agent-runtime.ts`, `session-factory.ts`) — tests never touch a provider.
3. **Confinement**: agent sessions get `cwd` + explicit `tools`, never shell. `createJobSession` already parameterizes `systemPrompt / tools / cwd / customTools` — v2 reuses it as-is; **no new agent plumbing**.
4. **Event-driven renderer**: main persists → `broadcast()` → store merges into snapshot. Chat already streams via `evChatDelta/Done/Error` — v2 scopes those channels per task instead of inventing a new mechanism.
5. Work is spec'd and change-sized (two changes, §10).

## 1. System overview (v2 deltas highlighted)

```
+------------------------------------------------------------------+
| RENDERER (React 18, single AppProvider store)                    |
|  Topbar · Board shell · Drawer host · TaskEditor modal · Toast   |
|  ListsRail | TaskColumn | FocusColumn                            |
|                        (AI band over WorkArea: Notes | Ask AI)   |
+--------------------------------+---------------------------------+
  window.api (RendererApi, typed in shared/ipc.ts)     subscribe ev*
  | ipcMain.handle(...) persist-then-broadcast          |
+------------------------------------------------------------------+
| MAIN                                                            |
|  index.ts (wiring) — db → migrate → vault → queue → ipc → win   |
|  db.ts         lists/tasks/task_types/task_chat/jobs/…   (sync) |
|  NEW: migrate runner v1→v2  (schema_migrations, exists unused)  |
|  job-queue.ts  persisted runs: analysis | suggestion | ingest | |
|                NEW kind: 'run'  (generic engine)                |
|  jobs/analysis.ts   paper pipeline (untouched)                  |
|  NEW jobs/run.ts    generic type engine → vault note file       |
|  jobs/ingest.ts     deposit-first wiki (paper set unchanged)    |
|  NEW chat.ts → task-scoped sessions (generalizes v1 ChatSession)|
|  type-config.ts  NEW: catalog service (CRUD/seed/validation)    |
|  session-factory.ts / agent-runtime.ts   (unchanged seams)      |
|  paths.ts         (+ vault/types/ layouts if needed later)      |
+------------------------------------------------------------------+
  node:sqlite app.db        vault files            Pi SDK (2 seams)
```

**Nothing below the seams changes shape.** The new machinery is *dispatch logic* (which config feeds which session) plus *data* (catalog, task fields, transcripts).

## 2. Domain model (SQLite)

```
task_types                                  tasks (rebuilt in migration 1)
  key            TEXT PK  -- 'plain','paper_reading',   id, list_id FK, title
  label/emoji/description                     notes TEXT (canonical, see §2.1)
  has_sources    INT  -- Link field + paper    type TEXT FK→task_types(key)
                           resolution pipeline      ON UPDATE CASCADE, RESTRICT delete
  has_run        INT  -- generic engine btn   description TEXT ''   (NEW)
  auto_run       INT  -- run on My Day add    target TEXT ''         (NEW)
  tabs           TEXT -- 'notes'|'notes,chat' agent_status (renamed, generalized:
  default_tab    TEXT                          none|queued|running|ready|failed)
  finish_mode    TEXT -- 'wiki'|'none'       link/paper_title/mismatch_state/pdf_path
  prompt         TEXT -- markdown pack           (paper-only, kept as-is)
  tools          TEXT -- tool-group allowlist
  builtin        INT

task_chat (NEW)                 enrichment_jobs (kind CHECK widened: +'run')
  id, task_id FK, role, content,   -- queue machinery unchanged
  recorded INT DEFAULT 0,          analyses/suggestions/notes tables: paper only,
  created_at                       unchanged

settings: unchanged (+ light/dark theme key)
```

### 2.1 Where notes live

One writer principle: the `notes` column stays canonical for *all* types (chat "record finding" appends through the existing `notes:save` path — idempotent, no new storage). Vault files appear only where v1 already creates them (paper artifacts) and at **Finish**, where deposit copies content into `raw/` — that is the wiki's durability story, unchanged. No file-mirroring layer is introduced in v2.

### 2.2 Why `prompt` is a column, not a vault file

The wiki `CLAUDE.md` is a *user-owned artifact* → file. A type's prompt is *app config* edited in Settings → column, so catalog edits are transactional with the row, the agent session reads one string from the row, and there's no sync bug between DB and file. Skills become standalone files later when MCP/tool-packs arrive; the `tools` column is the seam that will carry `mcp:<server>` grants.

### 2.3 Status generalization

`analysis_status` → `agent_status`; `abstract_only` collapses into `ready` (the paper nuance survives in `analyses.level='abstract'`, which is where the badge logic moves). Paper's re-analysis gating (`ready|abstract_only` never re-run) reads `agent_status` + type. Chip rule: shown only when the type has a pipeline (`has_run|has_sources`) **and** status ≠ `none` — plain/JIRA-style tasks simply have no chip.

### 2.4 Migration

v1 ships `schema_migrations` but never uses it (`migrate()` only seeds a list). Migration **#1** introduces a real runner (`user_version` or the table; numbered, applied in order at startup):

1. create + seed `task_types` (5 rows: plain, paper_reading, learning_target, technical_survey, jira_task)
2. rebuild `tasks` — new columns, type FK, `analysis_status`→`agent_status` mapping (`abstract_only→ready`), CHECK widening
3. widen `enrichment_jobs.kind` CHECK (+'run'), create `task_chat`
4. table rebuilds need `PRAGMA foreign_keys=OFF` around them (child tables reference `tasks`); run outside a transaction per SQLite rules — implementation detail for `tasks.md`

Type semantics of the seeds: `plain` (no pipeline, tabs `notes`), `paper_reading` (sources+analysis, tabs `notes,chat`), `learning_target` (generic run, chat, target field matters), `technical_survey` (generic run, chat-first), `jira_task` (no pipeline, no chat, description/link matter — a real JIRA sync is an MCP story, not v2).

## 3. Dispatch: type config → capability

The type row is the *only* policy table; dispatch reads it, then chooses one of exactly four session modes — all built on `createJobSession`:

```
                    ┌─ has_sources ──► paper pipeline  (jobs/analysis.ts,
                    │      (seed paper_reading)          untouched; JSON artifact)
 task_types ────────┤
                    ├─ has_run ──────► generic run      (jobs/run.ts NEW:
                    │      (learning, survey)             confined session, cwd =
                    │                                    vault notes dir, prompt =
                    │                                    type.prompt + context,
                    │                                    writes notes/<id>.md,
                    │                                    queue+retry+progress as today)
                    │
                    └─ tabs ⊇ chat ──► task chat        (chat.ts NEW: interactive
                                         (learning, survey, paper)   streaming, no queue)
   plain / jira: no pipeline → status chip never leaves 'none'
```

- **Paper pipeline untouched**: resolution → extraction → strict-JSON analysis → suggestions stays byte-for-byte behavior.
- **Generic run** reuses the *wiki-agent pattern*: confined session (`read|write|edit|grep|find|ls`, no shell) with `cwd` = vault notes area, prompt = type prompt + `description/target/notes/link` context. Output = edits to `notes/<taskId>.md`; done → broadcast note-updated + `agent_status: ready`. `diffTouchedFiles`-style diffing becomes reusable later for a per-run ledger; v2 just needs the artifact.
- Runs are **enqueueable, cancellable, retryable** through the existing JobQueue — `auto_run` (fire on My Day add) is a per-type flag; v2 ships it `0` for generic types and keeps paper's add-to-day trigger as-is.

## 4. Task chat (per-task interactive sessions)

Generalizes the v1 `ChatSession` (single global, in-memory):

```
task chat lifecycle
  select task w/ chat tab  →  GET taskChat(taskId)         (transcript from task_chat)
  user sends               →  main: session = createJobSession{ cwd: vault,
                               systemPrompt: type.prompt + task context(+ analysis TLDR for paper),
                               tools: [] } ; history = last N transcript rows
  deltas → broadcast evChatDelta {taskId, delta}  →  store appends to that task's buffer
  turn done → persist {taskId, role, content} to task_chat
  "record finding"         →  marks row recorded=1, appends formatted excerpt to notes
                              via notes:save (single-writer)
  task switch / close      →  chat:closeTaskChat aborts session
```

One session alive per open task (a map in main, abort on close) — no queue entry per message. **Debug chat disappears**; its delta/done/error channels are reused with `taskId` added to the payload. Chat tab is hidden when `aiConfigured=false`.

## 5. Renderer architecture (change 1 + 2 renderer halves)

```
App
├─ Topbar            title · global search (Ctrl+K) · Activity ▤ · Settings ⚙ · theme
├─ Board (3 cols, min-width guards)
│   ├─ ListsRail (~180)      @ me row · lists + '＋ List' · nav: My Day is default mode
│   ├─ TaskColumn (~320)     header: mode/list name + [＋ New task]  (selected list)
│   │                        QuickAdd line · compact rows: emoji title [type][status]
│   ├─ FocusColumn (rest ≥50%)
│   │   ├─ AI band (collapsible)   per selected task: agent_status, step/progress,
│   │   │                           analysis output / suggestions, actions: Run · Finish
│   │   └─ WorkArea                 tabs from type.tabs: [Notes] CodeMirror · [Ask AI]
│   │                               task-scoped chat + Record buttons; Finish moves to band
├─ DrawerHost         Activity · Settings (with sub-pages incl. Task Types editor)
│                     — right-side overlay; focus column stays mounted
└─ TaskEditor modal   create + edit: Title · Type(select, shows description) · Description
                      · Target · Link (if type.has_sources) · My Day; used by ＋ New task
                      and row-double-click; replaces NewTaskForm and inline ✎ editing
```

**State.** One `AppProvider` still owns `AppSnapshot` — which now carries `types: TypeDef[]` (small catalog; renderer never round-trips for selects). New per-task chat state is **not** global-snapshot: opening a task fetches its transcript once, then subscribes to `ev:chat-*` (now taskId-scoped) while mounted; closing/unmount unsubscribes. Selecting a task opens the focus column (reopening a collapsed band, as today).

**Theme.** CSS-var swap: light tokens become defaults (`--bg`, `--text`, …), dark tokens retained behind a settings toggle; components untouched since v1 already styles via vars only.

## 6. IPC surface (shared/ipc.ts + preload + main in lockstep)

| Channel | Purpose |
|---|---|
| `types:list / create / update / duplicate / delete` | catalog CRUD (delete guarded: tasks must be reassigned first; rename cascades via FK) |
| `tasks:create / update` | args gain `description`, `target`, type accepts any catalog key |
| `taskChat:get / send / close / record` + `ev:chat-* {taskId,…}` | per-task chat (§4) |
| `notes:save` (unchanged) | chat-record reuses it |
| `settings:update` | + `theme` key |

`CreateTaskArgs` gains `{type?, description?, target?}`; `Task` gains the two fields + generalized status. Task *type* stays a plain string in the row; the renderer resolves display info from snapshot `types`.

## 7. Security & confinement (unchanged posture)

Generic-run sessions: vault-notes `cwd`, file tools only, **no shell ever**; chat sessions: zero tools by default, `noExtensions/noSkills` already set — v2 adds nothing to the trust surface. Future MCP grants arrive *as tools* (the `customTools` parameter in `createJobSession` is already wired to Pi's extension-`defineTool` seam — that's the verified hook, but it stays a spike until a later change).

## 8. Tests & seams

Existing seams cover everything: scripted `setSessionFactory` sessions drive generic-run and task-chat tests headlessly; `runScriptedSimplePrompt` covers suggestion jobs unchanged. New tests: migration fixture (v1 DB file → v2, data intact, statuses mapped), catalog CRUD + delete-guard, dispatch matrix (each seed type → expected capability/session config), chat record→notes idempotence. **No new seam needed** — evidence the design stays inside v1's laws.

## 9. File delta

```
NEW src/main/type-config.ts     catalog service + seed + validation
NEW src/main/jobs/run.ts        generic engine (queue handler)
NEW src/main/chat.ts            → task-scoped sessions (refactor of v1 ChatSession)
MOD src/main/db.ts              migration runner + migration #1 + mappers
MOD src/shared/types.ts / ipc.ts / preload / index.ts   (lockstep per CLAUDE.md)
REN src/renderer/…/Sidebar→ListsRail; views MyDayView/ListView→TaskColumn modes;
    detail-col→FocusColumn; + DrawerHost, TaskEditor, TypesSettings, ChatPanel;
    SettingsView gains sub-nav; styles.css theme tokens + board grid
```

## 10. Sequencing

**Change 1 `refine-board-ux`** — pure renderer: light theme tokens, board shell (rail/task/focus + drawers), My Day as col-2 mode, ＋ New task opening the *existing* NewTaskForm (swapped for the editor in change 2), compact chips layout. Shippable alone; zero schema risk.

**Change 2 `task-types-work-area`** — migration + catalog + type-config service; TaskEditor with uniform fields; generalized `agent_status` plumbing; generic `run` engine; task chat + record; settings sub-pages (types editor). Sits on change 1's shell.

**Stretch (design only, not shipped):** generic wiki-ingest for non-paper types (deposit-generalization + ingest prompt already parameterizable), MCP via `customTools` spike, per-list default type.

## 11. Risks / things to verify during implementation

- Migration runner is greenfield (v1 seeds inline) — rebuild mechanics with FK constraints must be proven on a v1 fixture.
- One-live-task-chat assumption: sessions are cheap but model-context resets per switch; acceptable v2.
- `ev:chat-*` gains `taskId` → old debug-chat consumers deleted in the same commit (no compat worry, single-user app).
- Window narrowness: min-width guard + rail/band collapse; note in design.
