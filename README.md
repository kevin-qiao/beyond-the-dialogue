# Work Board — AI-Native Work Board

**Beyond the dialogue: an AI-native work board where agents get things *done* under the hood while you simply work with tasks.**
**超越对话框：这是一块以任务为本的 AI 工作台——AI Agent 在后台把事情做成，你在前台只需要面对任务本身。**

---

## Why this app exists / 为什么会有这个软件

Most AI software today is a conversation with ambitions. You type, it talks; you type more, it talks more. But real daily work was never a dialogue — it is a pile of tasks, each carrying a purpose, and value only shows up when things get **done**, not when words are exchanged.

So Work Board starts from the opposite end, and I want it to stay that way:

- **Beyond the dialogue — 超越对话。** The future of AI is not a smarter chat box; it is an agent that understands your *purpose* and delivers results quietly underneath — reading, resolving, analyzing, drafting, organizing — while you keep moving through your day.
- **Work is not a conversation — 工作不是对话。** This app deliberately *weakens* the chat and *strengthens* the task. Every AI capability hangs off the task lifecycle, not off a text box: you put a paper into My Day → an agent quietly reads it and returns a structured analysis → you write notes → **Finish** deposits the raw material into your own wiki → an agent drafts the pages. At no point do you need to "chat with the AI" to make it happen. The board in front of you shows tasks, not a transcript.
- **Agents work under the hood — Agent 只该在后台工作。** They are confined, focused workers with clear tools and boundaries — never conversation partners you babysit, never a window that demands your attention.
- **You own the artifacts — 产出永远属于你。** Your notes and your wiki are plain markdown files you control. The agent is a reader, a writer, a helper — not a lock-in.
- **A plugin-centric future — 插件化的未来。** Under the hood sits a stable agent core (runtime, task types, engines, skills); the surface around it — layout, panels, functions — should become freely customizable, a workbench you assemble around your own workflow, not a fixed page shipped by someone else.

I believe AI-driven software will take this shape: results-oriented, task-centric, extensible — a *work board*, not a chat room. This repository is my attempt at that shape. Version 1 already works this way for paper reading; the path toward the full vision (task types, per-type working areas, pluggable layout) is designed in [`docs/architecture.md`](docs/architecture.md).

当前大多数 AI 软件，本质是一个「野心勃勃的对话框」：你说一句，它回一句。但真正的工作从来不是对话——它是一堆带着目的的任务，价值只发生在事情**被做成**的那一刻，而不是话被说完的那一刻。

所以 Work Board 从相反的方向出发，并且我希望它一直如此：

- **超越对话。** AI 的未来不是一个更聪明的聊天框，而是一个理解你的**意图**、在后台把结果做出来的 Agent——读论文、解析链接、分析、起草、整理——而你继续推进自己的一天。
- **工作不是对话。** 这个应用刻意**弱化聊天、强化任务逻辑**。每一项 AI 能力都挂在任务的生命周期上，而不是挂在输入框上：把一篇论文放进 My Day → Agent 在后台读完后交回结构化分析 → 你写笔记 → **完成**时先把原材料沉淀进你自己的 Wiki → Agent 草拟页面。整个过程你不需要「和 AI 聊天」，你面前的板子上是任务，不是聊天记录。
- **Agent 只在后台工作。** 它们是被约束的、专注的、带着明确工具与边界的执行者——不是需要你照看的对话对象，也不是抢占注意力的弹窗。
- **产出永远属于你。** 笔记与 Wiki 都是你能掌控的 Markdown 文件。Agent 是读者、写作者、帮手——不是把你锁进某个生态的钩子。
- **插件化的未来。** 底层是稳定的 Agent 核心（运行时、任务类型、引擎、技能），表层——布局、面板、功能——应当可以被自由定制：一块你围绕自己的工作流亲手拼装的工作台，而不是别人发货时固定的页面。

我相信 AI 驱动的软件会长成这个样子：结果导向、以任务为中心、可扩展——是一块**工作板**，而不是聊天室。这个仓库就是我对这种形态的尝试：v1 已经在「论文阅读」上按这个方式运转，走向完整愿景（任务类型、按类型定制的工作区、可插拔布局）的设计见 [`docs/architecture.md`](docs/architecture.md)。

## Today — what v1 does / 现在（v1）能做什么

- **My Day** — pick tasks for today; completed ones roll off each morning, unfinished ones carry over. / 选几个任务放进今天；完成的天亮后自动清空，没做完的留下来。
- **Lists, quick capture, search** — capture a task in one keystroke (Ctrl+N), search across everything (Ctrl+K). / 一键录入（Ctrl+N）、全局搜索（Ctrl+K）。
- **Paper-reading tasks** — attach an arXiv / DOI / publisher link or a PDF; a background agent resolves the paper, extracts the text, and returns a structured analysis (TL;DR, contributions, method…). Progress streams live; failures auto-retry with backoff. / 论文阅读任务：丢一个链接或 PDF，后台 Agent 自动解析、提取、分析，进度实时可见，失败自动重试。
- **Task type & link editing** — switch a task between *plain* and *paper reading*; editing a link invalidates stale analysis and re-runs it. / 随时切换任务类型、修改链接；链接一变，旧分析自动作废并重新生成。
- **Notes + wiki ingestion** — write notes on any task; **Finish** first copies raw material into your wiki's `raw/` (safe even if everything after fails), then an agent drafts wiki pages following the wiki's own schema; `.history/` snapshots make every ingest reversible. / 任意任务都能记笔记；点**完成**先把原材料落入 Wiki `raw/`（即使后续全部失败也不丢），再由 Agent 按 Wiki 自己的规则草拟页面，每次落库都有 `.history/` 快照可回退。
- **Activity view** — a ledger of what jobs the agent ran and which files it actually touched; failed ingests can be retried. / 活动视图：Agent 干了什么、动了哪些文件，一目了然，失败可重试。
- **AI is optional** — no provider configured? Tasks, notes, lists, and search still work fully. / AI 是可选项：不配模型，任务、笔记、清单、搜索照常好用。
- **Chat is intentionally minimal** — there is no big chat surface; the small debug chat exists only to inspect the configured model. Because work is not a conversation. / 聊天被刻意做得很少——只有一个调试入口，用来检查当前模型。因为工作不是对话。

## Where it's headed / 方向

- **Task types as user-defined workflows** — JIRA task, learning target, technical survey… each type carries its own prompt, skills, tools, and finish behavior; the AI handling is defined by your type, not hardcoded. / **任务类型即自定义工作流**——JIRA 任务、学习目标、技术调研……每种类型自带提示词、技能、工具与收尾行为；AI 怎么干活由「类型」说了算，而不是写死在代码里。
- **A working area per type** — a learning task opens a markdown workspace; a survey task opens a chat-and-record surface; the layout of your work follows the work itself. / **按类型定制的「工作区」**——学习任务打开 Markdown 工作区，调研任务打开对话+记录区：界面的形态跟随工作的形态。
- **Three-column board shell** — lists | tasks | AI focus, one persistent board instead of scattered pages. / **三栏工作板**——清单 | 任务 | AI 工作区，一屏到底，不再是一页页跳转。
- **Plugin-centric core** — MCP and third-party skills arrive as *tools the agent may use*, granted per task type; the UI becomes something you assemble. / **插件化的核心**——MCP 与第三方技能将以「Agent 可用的工具」形态接入，按任务类型授权；界面终将变成你可以自由拼装的东西。

Designs live in [`docs/architecture.md`](docs/architecture.md) (component diagram: [`docs/architecture.drawio`](docs/architecture.drawio)).

## Requirements / 环境要求

- **Node.js ≥ 22** — the dev toolchain; the app itself runs on the Node bundled with Electron.
- An AI provider API key **only if** you want AI features — see [Configuring AI](#configuring-ai--配置-ai).
- Linux (packaged builds): `libgtk-3-0`, `libnss3`, `libasound2`.
- 中文备注：Node.js ≥ 22 即可开始；AI 相关功能才需要 API Key（见下方「配置 AI」）。

## Getting started / 快速开始

```bash
npm install
npm run dev        # electron-vite dev server + Electron
```

`.npmrc` points npm and the Electron binary download at the npmmirror mirror — installs work on any platform as-is. `.npmrc` 已配置好 npmmirror 镜像（npm 包与 Electron 二进制），任何平台直接安装即可。

### Running on Windows / Windows 下运行

Install Node ≥ 22 from [nodejs.org](https://nodejs.org), then in PowerShell or Git Bash:

```powershell
npm install
npm run dev
```

Storage lands under `%APPDATA%`; the default wiki at `C:\Users\<you>\Documents\WorkBoard-Wiki`. 数据在 `%APPDATA%`，Wiki 默认在 `C:\Users\<你>\Documents\WorkBoard-Wiki`（可在设置里改）。

> If you copy the project from a WSL2/Linux checkout, **delete `node_modules` first** — it contains Linux-native binaries (esbuild) that won't run on Windows. Re-run `npm install`.
> 若从 WSL2/Linux 环境拷贝代码到 Windows，请先**删除 `node_modules`**（里面是 Linux 原生二进制，如 esbuild），再重新 `npm install`。

## Configuring AI / 配置 AI

Open **Settings → AI provider**, then: pick a **provider** (the list comes from the Pi model catalog) · pick a **model** (or type any model ID) · paste your **API key** · **Test connection**.

打开**设置 → AI provider**：选择 **provider**（来自 Pi 模型目录）→ 选择 **model**（也可以手输任意模型 ID）→ 填入 **API key** → **测试连接**。

Credentials live in the app's own `auth.json`/`models.json` under its user-data folder — never in `~/.pi` or anywhere shared with other tools. 密钥与模型信息存放在应用自己的 user-data 目录（`auth.json`/`models.json`），绝不触碰 `~/.pi` 或任何共享位置。未配置时只使用非 AI 功能。

## Where data lives / 数据存放在哪

| Kind | Location |
| ---- | -------- |
| Database | SQLite (`app.db`, WAL) in Electron's **userData** — `%APPDATA%` on Windows, `~/.config` on Linux, `~/Library/Application Support` on macOS |
| Vault | `<userData>/vault/` — `notes/<taskId>.md`, `analyses/<taskId>/`, attached `pdfs/` |
| Wiki | Configurable in **Settings**; defaults to `~/Documents/WorkBoard-Wiki` with `raw/`, `wiki/`, `index.md`, `log.md`, `CLAUDE.md` (the wiki schema), `.history/` snapshots |

数据库用 SQLite，副本与产物进 Vault，最终沉淀进你自己的 Markdown Wiki——三类存储，各司其职。

## Tests & checks / 测试与检查

```bash
npm run typecheck   # tsc --noEmit over node + web configs
npm test            # headless node:test suite — no Electron, no network, no API key
npx tsx --test test/core.test.ts
npx tsx --test --test-name-pattern="ingest" test/*.test.ts
```

测试完全本地、无头运行，不联网、不需要 API Key（Agent 会话全部可注入脚本替身）。

## Packaging / 打包

```bash
npm run dist        # electron-vite build + electron-builder → release/
```

Targets are **host-platform specific** — build on the OS you target: 目标平台由构建所在系统决定，请在对应系统上执行 `npm run dist`：

| OS | Target | Output |
| -- | ------ | ------ |
| Windows | NSIS installer | `release/WorkBoard Setup <ver>.exe` |
| Linux | AppImage + deb | `release/WorkBoard-<ver>.AppImage`, `*.deb` |
| macOS | dmg + zip | `release/WorkBoard-<ver>.dmg`, `*.zip` |

Cross-building (e.g. Windows installer from Linux) needs wine and is unsupported; installers are unsigned, so SmartScreen / Gatekeeper will warn on first launch. 跨平台交叉打包（如在 Linux 上打 Windows 包）需要 wine，暂不支持；安装包未签名，首次启动会被 SmartScreen / Gatekeeper 提示。

## Repository map / 代码结构

- `src/main` — Electron main process: SQLite store (`db.ts`), job queue (`job-queue.ts`), job kinds (`jobs/analysis.ts`, `jobs/suggestions.ts`, `jobs/ingest.ts`), paper resolution (`paper/resolve.ts`), wiki machinery (`wiki.ts`), and the two agent-runtime seams (`agent-runtime.ts`, `session-factory.ts`) — all Pi SDK usage stays behind these seams. / 主进程：SQLite、任务队列、三类任务、论文解析、Wiki 机制，以及两个 Agent 运行时接缝——所有 Pi SDK 调用都被挡在这两个接缝之后。
- `src/renderer` — React 18 UI (My Day / List / Activity / Settings views, plus a minimal debug Chat). / 界面层。
- `src/shared` — domain types and the IPC contract shared by all three layers. / 三端共享的类型与 IPC 契约。
- `docs/` — [`architecture.md`](docs/architecture.md) (v2 design) · [`architecture.drawio`](docs/architecture.drawio) · UI drafts (`ux-draft.drawio`, `workboard-ux.drawio`). / 设计与架构文档。
- `openspec/` — the spec source of truth (behavior specs, archived changes). / 行为规格的源头（OpenSpec）。
- [`LLM-WiKi.md`](LLM-WiKi.md) — the idea behind the wiki: finished reading tasks become a knowledge base you own. / Wiki 模式背后的想法：读过的都变成你的知识库。

## License / 协议

MIT — see [LICENSE](LICENSE) / 见 [LICENSE](LICENSE)。
