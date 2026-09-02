# Work Board

**AI-Native Work Board** — a desktop to-do app with an *embedded agent runtime*. Reading-paper tasks get AI analysis (TL;DR, contributions, method, follow-up suggestions) inside a private agent session, and finished tasks are ingested into your own markdown wiki by a confined agent — the [LLM-WiKi](LLM-WiKi.md) pattern. You keep the artifacts; the agent does the reading.

Built with Electron + React on top of the Pi coding-agent SDK (`@earendil-works/pi-coding-agent`, pinned). The design rationale and behavior specs live in [`openspec/changes/add-ai-native-work-board/`](openspec/changes/add-ai-native-work-board/).

## Features

- **My Day** — pick tasks for today; completed ones roll off each morning, unfinished ones carry over.
- **Lists, quick capture, and search** — capture a task in one keystroke (Ctrl+N), search across everything (Ctrl+K).
- **Paper-reading tasks** — attach an arXiv / DOI / publisher link or a PDF; a background job resolves the paper, extracts text (attached PDF → open-access fetch → abstract fallback), and runs an agent session that produces a structured analysis. Progress is streamed live; failures auto-retry with backoff.
- **Task type & link editing** — switch a task between *plain* and *paper reading*; editing (or clearing) a link invalidates stale metadata and re-queues analysis.
- **Notes + wiki ingestion** — write notes on any task; hitting **Finish** first copies the raw material into your wiki's `raw/` (a safety net that survives any later failure), then a background agent drafts wiki pages following the wiki's own schema, while `.history/` snapshots make every ingest reversible.
- **Activity view** — job history, ingest ledger (what the agent actually touched), retries for failed ingests.
- **AI is optional** — plain tasks, notes, lists, and search work fully without configuration; only analysis/suggestions/chat need a provider.

## Requirements

- **Node.js ≥ 22** (dev tooling; the app runtime itself uses the Node bundled with Electron).
- An AI provider API key **only if** you want the AI features — see [Configuring AI](#configuring-ai).
- Linux (packaged builds): `libgtk-3-0`, `libnss3`, `libasound2` (the AppImage/deb list them as dependencies).

## Getting started

```bash
npm install
npm run dev        # electron-vite dev server + Electron
```

`.npmrc` points npm and the Electron binary download at the npmmirror mirror — installs work on any platform as-is.

### Running on Windows

Everything above runs natively on Windows — no special steps. Install Node ≥ 22 from [nodejs.org](https://nodejs.org), then `npm install && npm run dev` in a PowerShell or Git Bash session. The app's storage lands under `%APPDATA%` and the default wiki at `C:\Users\<you>\Documents\WorkBoard-Wiki`.

> If you copy the project from a WSL2/Linux checkout, **delete `node_modules` first** — it contains Linux-native binaries (esbuild) that won't run on Windows. Re-run `npm install`.

## Tests & checks

```bash
npm run typecheck   # tsc --noEmit over node + web configs
npm test            # headless node:test suite — no Electron, no network, no API key
npx tsx --test test/core.test.ts              # single file
npx tsx --test --test-name-pattern="ingest" test/*.test.ts   # filtered cases
```

## Packaging

```bash
npm run dist        # electron-vite build + electron-builder → release/
```

Targets are declared in `electron-builder.yml` and are **host-platform specific** — build on the OS you target:

| OS      | Target                         | Output                                      |
| ------- | ------------------------------ | ------------------------------------------- |
| Windows | NSIS installer                 | `release/WorkBoard Setup <ver>.exe`         |
| Linux   | AppImage + deb                 | `release/WorkBoard-<ver>.AppImage`, `*.deb` |
| macOS   | dmg + zip                      | `release/WorkBoard-<ver>.dmg`, `*.zip`      |

Cross-building (e.g. a Windows installer from Linux) requires extra tooling like wine and is not supported — run `npm run dist` on the target platform. Installers are unsigned, so Windows SmartScreen / macOS Gatekeeper will warn on first launch.

## Configuring AI

Open **Settings → AI provider**:

1. Pick a **provider** (the list comes from the Pi model catalog — OpenAI and others; any provider with a chat/agent endpoint works).
2. Pick a **model** (the dropdown is populated from the provider) — you can type any model ID.
3. Paste your **API key** and hit **Test connection**.

Credentials and model metadata are stored in the app's own `auth.json`/`models.json` under the app's user-data folder — never in `~/.pi` or anywhere shared with other tools. With no key configured, the header shows *AI not configured* and only non-AI features are active.

## Where data lives

| Kind     | Location                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Database | SQLite (`app.db`, WAL) in Electron's **userData** — `%APPDATA%` on Windows, `~/.config` on Linux, `~/Library/Application Support` on macOS |
| Vault    | `<userData>/vault/` — `notes/<taskId>.md`, `analyses/<taskId>/`, attached `pdfs/`                            |
| Wiki     | Configurable in **Settings**; defaults to `~/Documents/WorkBoard-Wiki` with `raw/`, `wiki/`, `index.md`, `log.md`, `CLAUDE.md` (the wiki schema), and `.history/` snapshots |

## Repository map

- `src/main` — Electron main process: SQLite store (`db.ts`), job queue (`job-queue.ts`), the three job kinds (`jobs/analysis.ts`, `jobs/suggestions.ts`, `jobs/ingest.ts`), paper resolution (`paper/resolve.ts`), wiki machinery (`wiki.ts`), and the two agent-runtime seams (`agent-runtime.ts`, `session-factory.ts`).
- `src/renderer` — React 18 UI (My Day / List / Activity / Settings / debug Chat views).
- `src/shared` — domain types and the IPC contract shared by all three layers.
- `openspec/` — design rationale (D1–D8) and the four feature specs (the source of truth for behavior).
- `docs/ux-draft.drawio` — UI layout draft (open in draw.io).

## License

MIT — see [LICENSE](LICENSE).
