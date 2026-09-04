# Work Board — AI-Native Work Board

[English](README.md) · [简体中文](README.zh-CN.md)

**超越对话框：这是一块以任务为本的 AI 工作台——AI Agent 在后台把事情做成，你在前台只需要面对任务本身。**

---

## 为什么会有这个软件

当前大多数 AI 软件，本质是一个「野心勃勃的对话框」：你说一句，它回一句。但真正的工作从来不是对话——它是一堆带着目的的任务，价值只发生在事情**被做成**的那一刻，而不是话被说完的那一刻。

所以 Work Board 从相反的方向出发，并且我希望它一直如此：

- **超越对话。** AI 的未来不是一个更聪明的聊天框，而是一个理解你的**意图**、在后台把结果做出来的 Agent——读论文、解析链接、分析、起草、整理——而你继续推进自己的一天。
- **工作不是对话。** 这个应用刻意**弱化聊天、强化任务逻辑**。每一项 AI 能力都挂在任务的生命周期上，而不是挂在输入框上：把一篇论文放进 My Day → Agent 在后台读完后交回结构化分析 → 你写笔记 → **完成**时先把原材料沉淀进你自己的 Wiki → Agent 草拟页面。整个过程你不需要「和 AI 聊天」，你面前的板子上是任务，不是聊天记录。
- **Agent 只在后台工作。** 它们是被约束的、专注的、带着明确工具与边界的执行者——不是需要你照看的对话对象，也不是抢占注意力的弹窗。
- **产出永远属于你。** 笔记与 Wiki 都是你能掌控的 Markdown 文件。Agent 是读者、写作者、帮手——不是把你锁进某个生态的钩子。
- **插件化的未来。** 底层是稳定的 Agent 核心（运行时、任务类型、引擎、技能），表层——布局、面板、功能——应当可以被自由定制：一块你围绕自己的工作流亲手拼装的工作台，而不是别人发货时固定的页面。

我相信 AI 驱动的软件会长成这个样子：结果导向、以任务为中心、可扩展——是一块**工作板**，而不是聊天室。这个仓库就是我对这种形态的尝试：v1 已经在「论文阅读」上按这个方式运转，走向完整愿景（任务类型、按类型定制的工作区、可插拔布局）的设计见 [`docs/architecture.md`](docs/architecture.md)。

## 现在（v1）能做什么

- **My Day** — 选几个任务放进今天；完成的天亮后自动清空，没做完的留下来。
- **清单、快捷录入、全局搜索** — 一个按键录入任务（Ctrl+N），全局搜索（Ctrl+K）。
- **论文阅读任务** — 丢一个 arXiv / DOI / 出版社链接或 PDF，后台 Agent 自动解析论文、提取正文，返回结构化分析（TL;DR、贡献、方法……）。进度实时可见，失败自动重试。
- **任务类型与链接编辑** — 随时在 *普通任务* 与 *论文阅读* 之间切换；链接一变，旧分析自动作废并重新生成。
- **笔记 + Wiki 沉淀** — 任意任务都能记笔记；点**完成**时先把原材料复制进 Wiki 的 `raw/`（即使后续全部失败也不丢），再由 Agent 按 Wiki 自己的规则草拟页面；每次落库都有 `.history/` 快照，可回溯可重试。
- **活动视图** — Agent 跑过哪些任务、实际改动了哪些文件，全部留痕；失败的落库可以重试。
- **AI 是可选项** — 不配置模型，任务、笔记、清单、搜索照常完整可用。
- **聊天被刻意做得很少** — 只有一个调试入口，用来检查当前配置的模型。因为工作不是对话。

## 方向

- **任务类型即自定义工作流** — JIRA 任务、学习目标、技术调研……每种类型自带提示词、技能、工具与收尾行为；AI 怎么干活由「类型」说了算，而不是写死在代码里。
- **按类型定制的「工作区」** — 学习任务打开 Markdown 工作区，调研任务打开「对话 + 记录」区：界面的形态跟随工作的形态。
- **三栏工作板** — 清单 | 任务 | AI 工作区，一屏到底，不再是一页页跳转。
- **插件化的核心** — MCP 与第三方技能将以「Agent 可用的工具」形态接入、按任务类型授权；界面终将变成你可以自由拼装的东西。

设计与架构见 [`docs/architecture.md`](docs/architecture.md)（组件图：[`docs/architecture.drawio`](docs/architecture.drawio)）。

## 环境要求

- **Node.js ≥ 22** — 开发工具链需要；应用本体运行在 Electron 内置的 Node 上。
- AI 相关功能才需要 API Key（见下方「配置 AI」）。
- Linux 打包版依赖 `libgtk-3-0`、`libnss3`、`libasound2`。

## 快速开始

```bash
npm install
npm run dev        # electron-vite dev server + Electron
```

`.npmrc` 已配置好 npmmirror 镜像（npm 包与 Electron 二进制），任何平台直接安装即可。

### Windows 下运行

到 [nodejs.org](https://nodejs.org) 安装 Node ≥ 22，然后在 PowerShell 或 Git Bash 里：

```powershell
npm install
npm run dev
```

数据存放在 `%APPDATA%`；Wiki 默认在 `C:\Users\<你>\Documents\WorkBoard-Wiki`（可在设置里修改）。

> 若从 WSL2/Linux 环境拷贝代码到 Windows，请先**删除 `node_modules`**（里面是 Linux 原生二进制，如 esbuild），再重新 `npm install`。

## 配置 AI

打开**设置 → AI provider**：

1. 选择 **provider**（列表来自 Pi 模型目录）。
2. 选择 **model**（下拉框会按 provider 拉取，也可以手输任意模型 ID）。
3. 填入 **API key**，点**测试连接**。

密钥与模型信息存放在应用自己的 user-data 目录（`auth.json` / `models.json`），绝不触碰 `~/.pi` 或任何与其它工具共享的位置。未配置时顶部会显示 *AI not configured*，仅使用非 AI 功能。

## 数据存放在哪

| 类别 | 位置 |
| ---- | ---- |
| 数据库 | SQLite（`app.db`，WAL），在 Electron 的 **userData** 下 — Windows 为 `%APPDATA%`，Linux 为 `~/.config`，macOS 为 `~/Library/Application Support` |
| Vault | `<userData>/vault/` — `notes/<taskId>.md`、`analyses/<taskId>/`、附件 `pdfs/` |
| Wiki | 在**设置**中可改；默认 `~/Documents/WorkBoard-Wiki`，内含 `raw/`、`wiki/`、`index.md`、`log.md`、`CLAUDE.md`（Wiki 规则）与 `.history/` 快照 |

三类存储各司其职：SQLite 管状态，Vault 管中间产物，你自己的 Markdown Wiki 沉淀最终知识。

## 测试与检查

```bash
npm run typecheck   # tsc --noEmit（node 与 web 两套配置）
npm test            # 无头测试 — 不启动 Electron、不联网、不需要 API Key
npx tsx --test test/core.test.ts
npx tsx --test --test-name-pattern="ingest" test/*.test.ts
```

测试完全本地、无头运行：Agent 会话全部可以注入脚本替身，因此永远不需要真实 API Key。

## 打包

```bash
npm run dist        # electron-vite build + electron-builder → release/
```

打包目标**随构建所在系统而定**，请在目标平台上执行 `npm run dist`：

| 系统 | 目标 | 产物 |
| ---- | ---- | ---- |
| Windows | NSIS 安装包 | `release/WorkBoard Setup <ver>.exe` |
| Linux | AppImage + deb | `release/WorkBoard-<ver>.AppImage`、`*.deb` |
| macOS | dmg + zip | `release/WorkBoard-<ver>.dmg`、`*.zip` |

跨平台交叉打包（如在 Linux 上打 Windows 包）需要 wine，暂不支持；安装包未签名，首次启动会被 SmartScreen / Gatekeeper 提示。

## 代码结构

- `src/main` — Electron 主进程：SQLite 存储（`db.ts`）、任务队列（`job-queue.ts`）、三类任务（`jobs/analysis.ts`、`jobs/suggestions.ts`、`jobs/ingest.ts`）、论文解析（`paper/resolve.ts`）、Wiki 机制（`wiki.ts`），以及两个 Agent 运行时接缝（`agent-runtime.ts`、`session-factory.ts`）——所有 Pi SDK 调用都被挡在这两个接缝之后。
- `src/renderer` — React 18 界面（My Day / List / Activity / Settings，外加一个极简调试 Chat）。
- `src/shared` — 三端共享的领域类型与 IPC 契约。
- `docs/` — [`architecture.md`](docs/architecture.md)（v2 设计）· [`architecture.drawio`](docs/architecture.drawio) · UX 布局草稿（`workboard-ux.drawio`）。
- `openspec/` — 行为规格的源头（OpenSpec：规格与已归档的变更）。
- [`LLM-WiKi.md`](LLM-WiKi.md) — Wiki 模式背后的想法：读完的东西都沉淀成你拥有的知识库。

## 协议

MIT — 见 [LICENSE](LICENSE)。
