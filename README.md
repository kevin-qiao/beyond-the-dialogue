# Work Board — AI-Native Work Board

[English](README.md) · [简体中文](README.zh-CN.md)

**Beyond the dialogue: an AI-native work board where agents get things *done* under the hood while you simply work with tasks.**

---

## Why this app exists

Most AI software today is a conversation with ambitions. You type, it talks; you type more, it talks more. But real daily work was never a dialogue — it is a pile of tasks, each carrying a purpose, and value only shows up when things get **done**, not when words are exchanged.

So Work Board starts from the opposite end, and I want it to stay that way:

- **Beyond the dialogue.** The future of AI is not a smarter chat box; it is an agent that understands your *purpose* and delivers results quietly underneath — reading, resolving, analyzing, drafting, organizing — while you keep moving through your day.
- **Work is not a conversation.** This app deliberately *weakens* the chat and *strengthens* the task. Every AI capability hangs off the task lifecycle, not off a text box: you put a paper into My Day → an agent quietly reads it and returns a structured analysis → you write notes → **Finish** deposits the raw material into your own wiki → an agent drafts the pages. At no point do you need to "chat with the AI" to make it happen. The board in front of you shows tasks, not a transcript.
- **Agents work under the hood.** They are confined, focused workers with clear tools and boundaries — never conversation partners you babysit, never a window that demands your attention.
- **You own the artifacts.** Your notes and your wiki are plain markdown files you control. The agent is a reader, a writer, a helper — not a lock-in.
- **A plugin-centric future.** Under the hood sits a stable agent core (runtime, task types, engines, skills); the surface around it — layout, panels, functions — should become freely customizable, a workbench you assemble around your own workflow, not a fixed page shipped by someone else.

I believe AI-driven software will take this shape: results-oriented, task-centric, extensible — a *work board*, not a chat room. This repository is my attempt at that shape. Version 1 already works this way for paper reading; the path toward the full vision (task types, per-type working areas, pluggable layout) is designed in [`docs/architecture.md`](docs/architecture.md).

## Today — what v1 does

- **My Day** — pick tasks for today; completed ones roll off each morning, unfinished ones carry over.
- **Lists, quick capture, search** — capture a task in one keystroke (Ctrl+N), search across everything (Ctrl+K).
- **Paper-reading tasks** — attach an arXiv / DOI / publisher link or a PDF; a background agent resolves the paper, extracts the text, and returns a structured analysis (TL;DR, contributions, method…). Progress streams live; failures auto-retry with backoff.
- **Task type & link editing** — switch a task between *plain* and *paper reading*; editing a link invalidates stale analysis and re-runs it.
- **Notes + wiki ingestion** — write notes on any task; **Finish** first copies raw material into your wiki's `raw/` (safe even if everything after fails), then an agent drafts wiki pages following the wiki's own schema; `.history/` snapshots make every ingest reversible.
- **Activity view** — a ledger of what jobs the agent ran and which files it actually touched; failed ingests can be retried.
- **AI is optional** — no provider configured? Tasks, notes, lists, and search still work fully.
- **Chat is intentionally minimal** — there is no big chat surface; the small debug chat exists only to inspect the configured model. Because work is not a conversation.

## Where it's headed

- **Task types as user-defined workflows** — JIRA task, learning target, technical survey… each type carries its own prompt, skills, tools, and finish behavior; the AI handling is defined by your type, not hardcoded.
- **A working area per type** — a learning task opens a markdown workspace; a survey task opens a chat-and-record surface; the layout of your work follows the work itself.
- **Three-column board shell** — lists | tasks | AI focus, one persistent board instead of scattered pages.
- **Plugin-centric core** — MCP and third-party skills arrive as *tools the agent may use*, granted per task type; the UI becomes something you assemble.

Designs live in [`docs/architecture.md`](docs/architecture.md) (component diagram: [`docs/architecture.drawio`](docs/architecture.drawio)).

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
| Vault | `<userData>/vault/` — `notes/<taskId>.md`, `analyses/<taskId>/`, attached `pdfs/` |
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
| Windows | NSIS installer | `release/WorkBoard Setup <ver>.exe` |
| Linux | AppImage + deb | `release/WorkBoard-<ver>.AppImage`, `*.deb` |
| macOS | dmg + zip | `release/WorkBoard-<ver>.dmg`, `*.zip` |

Cross-building (e.g. a Windows installer from Linux) needs wine and is unsupported; installers are unsigned, so SmartScreen / Gatekeeper will warn on first launch.

## Repository map

- `src/main` — Electron main process: SQLite store (`db.ts`), job queue (`job-queue.ts`), job kinds (`jobs/analysis.ts`, `jobs/suggestions.ts`, `jobs/ingest.ts`), paper resolution (`paper/resolve.ts`), wiki machinery (`wiki.ts`), and the two agent-runtime seams (`agent-runtime.ts`, `session-factory.ts`) — all Pi SDK usage stays behind these seams.
- `src/renderer` — React 18 UI (My Day / List / Activity / Settings views, plus a minimal debug Chat).
- `src/shared` — domain types and the IPC contract shared by all three layers.
- `docs/` — [`architecture.md`](docs/architecture.md) (v2 design) · [`architecture.drawio`](docs/architecture.drawio) · UX layout draft (`workboard-ux.drawio`).
- `openspec/` — the spec source of truth (behavior specs, archived changes).
- [`LLM-WiKi.md`](LLM-WiKi.md) — the idea behind the wiki: finished reading tasks become a knowledge base you own.

## License

MIT — see [LICENSE](LICENSE).
