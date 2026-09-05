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
- **Workflow types** — built-in *plain*, *learning*, and *JIRA/Confluence* types, plus user-defined types from Settings: pick a behavior kind, label, emoji, input fields, and AI guidance. New types need no code.
- **AI pre-process** — add a typed task to My Day and a background agent generates its working prompt, a summary, and 2–3 activity suggestions; outputs refresh when relevant inputs change. Progress streams live; transient failures auto-retry with backoff.
- **Per-type working areas** — a learning task opens a live markdown editor with a task-grounded chat panel; a JIRA/Confluence task opens a source panel, chat, and local comment drafts (no connector yet — nothing is ever posted remotely).
- **Finish + wiki ingestion** — **Finish** on a learning task first copies raw material into your wiki's `raw/` (safe even if everything after fails), then a confined agent writes the curated note at the learning-note path following the wiki's own schema; `.history/` snapshots make every ingest reversible.
- **Task alarms** — set a date-time on any task; an OS notification fires at that moment and opens the task.
- **Skills & MCP management (config-only)** — Settings lets you record skills and MCP servers now; the agent will use them when the connector wiring lands (next change: `add-mcp-support`).
- **Activity view** — a ledger of what jobs the agent ran and which files it actually touched; failed ingests can be retried.
- **AI is optional** — no provider configured? Tasks, notes, lists, search, and alarms still work fully.
- **Chat is where work needs it** — chat is embedded in typed working areas for grounding, not a central surface; a small debug chat remains to inspect the configured model. Because work is not a conversation.

## Where it's headed

- **Live connectors** — JIRA/Confluence reading and updating through MCP servers; skills as agent tools; grants per task type (design already specced in `openspec/changes/add-mcp-support/`).
- **A plugin-centric surface** — the UI becomes something you assemble around the agent core.

Feature behavior is specified in [`openspec/`](openspec/) — the spec source of truth (`openspec/specs/` after archiving, active changes under `openspec/changes/`).

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

- `src/main` — Electron main process: SQLite store + type registry (`db.ts`, `types.ts`), job machinery (`job-queue.ts` + handlers `preprocess.ts`, `suggestions.ts`, `wiki/ingest.ts`), alarms (`alarms.ts`), plugin validation (`plugins.ts`), wiki scaffolding (`wiki/wiki.ts`, `wiki/vault.ts`), and the two agent-runtime seams (`ai/agent-runtime.ts`, `ai/session-factory.ts`) — all Pi SDK usage stays behind these seams.
- `src/renderer` — React 18 UI: three-column board (`components/board/`), per-kind working areas + chat panel (`components/focus/`), drawer overlays for Activity/Settings/chat (`components/overlays/`), shared primitives (`components/ui/`).
- `src/shared` — domain types and the IPC contract shared by all three layers.
- `openspec/` — the spec source of truth (behavior specs, active + archived changes).
- The wiki pattern guide — every wiki space the app creates is seeded with an `LLM-WiKi.md` (bundled at `src/main/wiki/LLM-WiKi.md`): finished learning notes become a knowledge base you own.

## License

MIT — see [LICENSE](LICENSE).
