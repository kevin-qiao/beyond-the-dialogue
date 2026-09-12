# Beyond the Dialogue — an AI-native work board

[English](README.md) · [简体中文](README.zh-CN.md)

**Beyond the Dialogue: an AI-native work board where agents get things *done* under the hood while you simply work with tasks.**

---

## Why this app exists

Most AI software today is a conversation with ambitions. You type, it talks; you type more, it talks more. But real daily work was never a dialogue — it is a pile of tasks, each carrying a purpose, and value only shows up when things get **done**, not when words are exchanged.

So Beyond the Dialogue starts from the opposite end, and I want it to stay that way:

- **Beyond the dialogue.** The future of AI is not a smarter chat box; it is an agent that understands your *purpose* and delivers results quietly underneath — reading, resolving, analyzing, drafting, organizing — while you keep moving through your day.
- **Work is not a conversation.** This app deliberately *weakens* the chat and *strengthens* the task. Every AI capability hangs off the task lifecycle, not off a text box: you put a learning task into My Day → an agent quietly pre-processes it and returns a working prompt, a summary, and activity suggestions → you write the note → **Finish** deposits the raw material into your own wiki → an agent drafts the pages. At no point do you need to "chat with the AI" to make it happen. The board in front of you shows tasks, not a transcript.
- **Agents work under the hood.** They are confined, focused workers with clear tools and boundaries — never conversation partners you babysit, never a window that demands your attention.
- **You own the artifacts.** Your notes and your wiki are plain markdown files you control. The agent is a reader, a writer, a helper — not a lock-in.
- **A plugin-centric future.** Under the hood sits a stable agent core (runtime, task types, engines, skills); the surface around it — layout, panels, functions — should become freely customizable, a workbench you assemble around your own workflow, not a fixed page shipped by someone else.

I believe AI-driven software will take this shape: results-oriented, task-centric, extensible — a *work board*, not a chat room. This repository is my attempt at that shape. v0.8 works this way through the **type engine**: every task carries a workflow type, and the type — not hardcoded flows — decides the task's inputs, its AI pre-process, its working area, and its Finish behavior.

## Today — what v0.8 does

- **My Day** — pick tasks for today; completed ones roll off each morning, unfinished ones carry over.
- **Lists, quick capture, search** — capture a task in one keystroke (Ctrl+N), search across everything (Ctrl+K).
- **Workflow types** — built-in *plain*, *learning*, *JIRA/Confluence* and *meeting* types, plus user-defined types from Settings: pick a behaviour category, label, emoji, input fields, AI instruction, output destination, and finish behaviour. New types need no code.
- **AI pre-process** — add a typed task to My Day and a background agent generates its working prompt, a summary, and 2–3 activity suggestions; outputs refresh when relevant inputs change. Progress streams live; transient failures auto-retry with backoff.
- **Meeting minutes** — a meeting task pre-processes to a suggested agenda and the core topics worth covering; you write the minutes in the same live markdown editor, and **Finish** has the assistant re-organize and polish them into a plain markdown file in a folder you choose. Anything the assistant might have invented is caught before it is filed: every action item and fact it reports has to be traceable to what you actually wrote, and the recorded action items are appended as a distinct section rather than left to the model.
- **Output destinations, per type** — each type declares where its finished work goes: a folder you own (with an optional subfolder) or the wiki. Change it in Settings and subsequent finishes follow it; artifacts already saved stay exactly where they are. A destination that resolves outside its root is refused, never silently mis-saved.
- **Four finish behaviours** — every type declares one: *complete only*, *file as-is*, *polish then file*, or *deposit then curate* (the learning flow: raw material preserved first, then a confined agent authors the note). Dispatch is on what the type declares, not on a hardcoded type name.
- **Per-type working areas** — a learning or meeting task opens a live markdown editor with a task-grounded chat panel; a JIRA/Confluence task opens a source panel, chat, and local comment drafts.
- **Finish + wiki ingestion** — **Finish** on a learning task first copies raw material into your wiki's `raw/` (safe even if everything after fails), then a confined agent writes the curated note at the learning-note path following the wiki's own schema; `.history/` snapshots make every ingest reversible.
- **Task alarms** — set a date-time on any task; an OS notification fires at that moment and opens the task.
- **Skills and tool servers, granted per type** — Settings lets you record skills and MCP servers, and grant specific ones to a type. Confined background work — ingestion, polishing, suggestions — never receives a grant under any configuration. Granting external reach makes a session *less* rich, deliberately: it then sees only the task's declared inputs and your request, never your notes, minutes, drafts or wiki. A remote change is never made from a conversation: the assistant can only *propose* one, and you see exactly what would be sent before confirming it.
  **Not yet connected:** the transport that would let a granted tool server actually reach its external system is deferred — see [Where it's headed](#where-its-headed) and the FR-018 amendment in `specs/001-extensible-type-workflows/spec.md`.
- **Activity view** — a ledger of what jobs the agent ran and which files it actually touched; failed ingests can be retried.
- **AI is optional** — no provider configured? Tasks, notes, lists, search, and alarms still work fully.
- **Chat is where work needs it** — chat is embedded in typed working areas for grounding, not a central surface; a small debug chat remains to inspect the configured model. Because work is not a conversation.

## Where it's headed

- **Live connectors** — the tool-server transport, so a granted server can actually be read from and acted on. The grant seam, the confinement guarantee, the egress boundary and the propose-then-confirm model all ship today and are tested against a scripted tool double; only the connection is missing. The community adapter that was to provide it failed its reproducibility gate — its dependencies pinned preview-registry commit URLs rather than published npm versions — so the adoption was deferred rather than forced in. The evidence is in `specs/001-extensible-type-workflows/research.md` R7a, and FR-018 is amended rather than left claiming unbuilt behaviour.
- **A plugin-centric surface** — the UI becomes something you assemble around the agent core.

Feature behavior is specified in [`specs/`](specs/) — the spec source of truth, written with the Spec Kit workflow. The governing principles live in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Requirements

- **Node.js ≥ 22** — the dev toolchain; the app itself runs on the Node bundled with Electron.
- An AI provider API key **only if** you want AI features — see [Configuring AI](#configuring-ai).
- Linux (packaged builds): `libgtk-3-0`, `libnss3`, `libasound2`.

## Getting started

```bash
npm install
npm run dev        # electron-vite dev server + Electron
```

`.npmrc` points npm and the Electron binary download at the npmmirror mirror — installs work on any platform as-is.

### Running on Windows

Install Node ≥ 22 from [nodejs.org](https://nodejs.org), then in PowerShell or Git Bash:

```powershell
npm install
npm run dev
```

Storage lands under `%APPDATA%`; the default wiki at `C:\Users\<you>\Documents\WorkBoard-Wiki` (changeable in Settings).

> If you copy the project from a WSL2/Linux checkout, **delete `node_modules` first** — it contains Linux-native binaries (esbuild) that won't run on Windows. Re-run `npm install`.

> For building and packaging on Windows (native rendering, NSIS installer), see [`WINDOWS.md`](WINDOWS.md).

## Configuring AI

Open **Settings → AI provider**, then:

1. Pick a **provider** (the list comes from the Pi model catalog).
2. Pick a **model** (the dropdown is populated from the provider — or type any model ID).
3. Paste your **API key** and hit **Test connection**.

Credentials and model metadata live in the app's own `auth.json`/`models.json` under its user-data folder — never in `~/.pi` or anywhere shared with other tools. With no key configured, the header shows *AI not configured* and only non-AI features are active.

## Where data lives

| Kind | Location |
| ---- | -------- |
| Database | SQLite (`app.db`, WAL) in Electron's **userData** — `%APPDATA%` on Windows, `~/.config` on Linux, `~/Library/Application Support` on macOS |
| Vault | `<userData>/vault/` — working notes as `notes/<taskId>.md` |
| Wiki | Configurable in **Settings**; defaults to `~/Documents/WorkBoard-Wiki` with `raw/`, `wiki/`, `index.md`, `log.md`, `CLAUDE.md` (the wiki schema), `.history/` snapshots |

Three storage kinds, each doing its own job: SQLite for state, the vault for artifacts, your markdown wiki for durable knowledge.

## Tests & checks

```bash
npm run typecheck   # tsc --noEmit over node + web configs
npm test            # headless node:test suite — no Electron, no network, no API key
npx tsx --test test/core.test.ts
npx tsx --test --test-name-pattern="ingest" test/*.test.ts
```

The suite runs headless and offline — agent sessions are injectable scripted stand-ins, so no API key is ever needed.

`npm run typecheck` checks **both** TypeScript projects. The root `tsconfig.json` is a solution file (`"files": []` plus project references), and `tsc --noEmit` against a solution file compiles nothing — so the script names each project explicitly. Until it did, the gate silently passed on a codebase with real type errors in it.

## Packaging

```bash
npm run dist        # electron-vite build + electron-builder → release/
```

Targets are **host-platform specific** — build on the OS you target:

| OS | Target | Output |
| -- | ------ | ------ |
| Windows | NSIS installer | `release/Beyond the Dialogue Setup <ver>.exe` |
| Linux | AppImage + deb | `release/Beyond the Dialogue-<ver>.AppImage`, `*.deb` |
| macOS | dmg + zip | `release/Beyond the Dialogue-<ver>.dmg`, `*.zip` |

Cross-building (e.g. a Windows installer from Linux) needs wine and is unsupported; installers are unsigned, so SmartScreen / Gatekeeper will warn on first launch.

## Repository map

- `src/core` — **domain and application, with no I/O.** Pure rules (categories, destinations, the four finish behaviours, validation, grants) and the use cases that orchestrate them, plus the ports those use cases depend on. It imports no `electron`, no `node:*` and no DOM global, because it is compiled into both the main and the renderer targets; `test/layering.test.ts` enforces that mechanically. See `src/core/README.md`.
- `src/main` — Electron host and adapters: the composition root (`index.ts`), SQLite store + type registry (`db.ts`, `types.ts`), job machinery (`job-queue.ts` + handlers `preprocess.ts`, `suggestions.ts`, `wiki/ingest.ts`), alarms (`alarms.ts`), plugin validation (`plugins.ts`), wiki scaffolding (`wiki/wiki.ts`, `wiki/vault.ts`), and the adapters that implement `src/core`'s ports — `adapters/sqlite/`, `adapters/artifacts/` (the wiki and plain-folder artifact stores), `adapters/agent/` (the session adapter and the Pi runtime seam), `adapters/notifier.ts`, `adapters/paths.ts`.
- `src/renderer` — React 18 UI: three-column board (`components/board/`), per-kind working areas + chat panel + remote-change confirmations (`components/focus/`), drawer overlays for Activity/Settings/chat (`components/overlays/`), shared primitives (`components/ui/`).
- `src/shared` — domain types and the typed IPC contract (commands, events, and every payload keyed by channel) shared by all three layers.
- `specs/` — the spec source of truth (feature specifications).
- `.specify/` — Spec Kit configuration: templates, scripts, and the project constitution.
- The wiki pattern guide — every wiki space the app creates is seeded with an `LLM-WiKi.md` (bundled at `src/main/wiki/LLM-WiKi.md`): finished learning notes become a knowledge base you own.

## License

MIT — see [LICENSE](LICENSE).
