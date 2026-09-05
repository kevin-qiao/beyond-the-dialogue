# Beyond the Dialogue — 以任务为本的 AI 工作台

[English](README.md) · [简体中文](README.zh-CN.md)

**超越对话框：这是一块以任务为本的 AI 工作台——AI Agent 在后台把事情做成，你在前台只需要面对任务本身。**

---

## 为什么会有这个软件

当前大多数 AI 软件，本质是一个「野心勃勃的对话框」：你说一句，它回一句。但真正的工作从来不是对话——它是一堆带着目的的任务，价值只发生在事情**被做成**的那一刻，而不是话被说完的那一刻。

所以 Beyond the Dialogue 从相反的方向出发，并且我希望它一直如此：

- **超越对话。** AI 的未来不是一个更聪明的聊天框，而是一个理解你的**意图**、在后台把结果做出来的 Agent——阅读、解析、分析、起草、整理——而你继续推进自己的一天。
- **工作不是对话。** 这个应用刻意**弱化聊天、强化任务逻辑**。每一项 AI 能力都挂在任务的生命周期上，而不是挂在输入框上：把一个学习任务放进 My Day → Agent 在后台完成预处理，交回工作提示、摘要与活动建议 → 你写笔记 → **完成**时先把原材料沉淀进你自己的 Wiki → Agent 草拟页面。整个过程你不需要「和 AI 聊天」，你面前的板子上是任务，不是聊天记录。
- **Agent 只在后台工作。** 它们是被约束的、专注的、带着明确工具与边界的执行者——不是需要你照看的对话对象，也不是抢占注意力的弹窗。
- **产出永远属于你。** 笔记与 Wiki 都是你能掌控的 Markdown 文件。Agent 是读者、写作者、帮手——不是把你锁进某个生态的钩子。
- **插件化的未来。** 底层是稳定的 Agent 核心（运行时、任务类型、引擎、技能），表层——布局、面板、功能——应当可以被自由定制：一块你围绕自己的工作流亲手拼装的工作台，而不是别人发货时固定的页面。

我相信 AI 驱动的软件会长成这个样子：结果导向、以任务为中心、可扩展——是一块**工作板**，而不是聊天室。这个仓库就是我对这种形态的尝试：v0.8 已经以**类型引擎**运转——每个任务都携带一个工作流类型，由类型（而不是写死的流程）决定它的输入、AI 预处理、工作区与完成行为。

## 现在（v0.8）能做什么

- **My Day** — 选几个任务放进今天；完成的天亮后自动清空，没做完的留下来。
- **清单、快捷录入、全局搜索** — 一个按键录入任务（Ctrl+N），全局搜索（Ctrl+K）。
- **工作流类型** — 内置 *普通*、*学习*、*JIRA/Confluence* 三种类型；还可以在设置里自定义类型：选择行为类别、名称、表情、输入字段与 AI 指引。新类型不需要写代码。
- **AI 预处理** — 把类型任务放进 My Day，后台 Agent 生成工作提示、摘要与 2–3 条活动建议；相关输入变化后自动重算。进度实时可见，瞬时失败自动重试。
- **按类型定制的「工作区」** — 学习任务打开 Markdown 编辑器 + 挂在任务上下文上的聊天面板；JIRA/Confluence 任务打开原文区、聊天与本地评论草稿（v0.8 无连接器，绝不会向远端写入任何内容）。
- **完成 + Wiki 沉淀** — 学习任务点**完成**时先把原材料复制进 Wiki 的 `raw/`（即使后续全部失败也不丢），再由受限 Agent 按 Wiki 规则把学习笔记写到指定路径；每次落库都有 `.history/` 快照，可回溯可重试。
- **任务闹钟** — 给任意任务设定日期时间，到点弹出系统通知并打开该任务。
- **技能与 MCP 管理（仅配置）** — 设置里现在就能登记技能与 MCP 服务器；Agent 真正接入是下一个变更（`add-mcp-support`）的事。
- **活动视图** — Agent 跑过哪些任务、实际改动了哪些文件，全部留痕；失败的落库可以重试。
- **AI 是可选项** — 不配置模型，任务、笔记、清单、搜索、闹钟照常完整可用。
- **聊天出现在需要的地方** — 聊天面板嵌在类型工作区里用于「带着上下文提问」，不再是中心界面；另保留一个调试入口检查模型。因为工作不是对话。

## 方向

- **活的连接器** — 通过 MCP 服务器读写 JIRA/Confluence；技能成为 Agent 可用工具，按任务类型授权（设计已在 `openspec/changes/add-mcp-support/` 中定稿）。
- **插件化的表层** — 界面终将变成你可以围绕 Agent 核心自由拼装的东西。

行为规格以 [`openspec/`](openspec/) 为准（归档后的主规格在 `openspec/specs/`，进行中的变更在 `openspec/changes/`）。

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
| Vault | `<userData>/vault/` — 工作笔记 `notes/<taskId>.md` |
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
| Windows | NSIS 安装包 | `release/Beyond the Dialogue Setup <ver>.exe` |
| Linux | AppImage + deb | `release/Beyond the Dialogue-<ver>.AppImage`、`*.deb` |
| macOS | dmg + zip | `release/Beyond the Dialogue-<ver>.dmg`、`*.zip` |

跨平台交叉打包（如在 Linux 上打 Windows 包）需要 wine，暂不支持；安装包未签名，首次启动会被 SmartScreen / Gatekeeper 提示。

## 代码结构

- `src/main` — Electron 主进程：SQLite 存储与类型注册表（`db.ts`、`types.ts`）、任务队列机制（`job-queue.ts`，handler 在 `preprocess.ts`、`suggestions.ts`、`wiki/ingest.ts`）、闹钟（`alarms.ts`）、插件校验（`plugins.ts`）、Wiki 脚手架（`wiki/wiki.ts`、`wiki/vault.ts`），以及两个 Agent 运行时接缝（`ai/agent-runtime.ts`、`ai/session-factory.ts`）——所有 Pi SDK 调用都被挡在这两个接缝之后。
- `src/renderer` — React 18 界面：三栏工作板（`components/board/`）、按类型的工作区与聊天面板（`components/focus/`）、抽屉浮层（`components/overlays/`）、共享控件（`components/ui/`）。
- `src/shared` — 三端共享的领域类型与 IPC 契约。
- `openspec/` — 行为规格的源头（OpenSpec：规格、进行中与已归档的变更）。
- Wiki 模式指南 — 应用创建的每个 Wiki 空间都会植入一份 `LLM-WiKi.md`（模板位于 `src/main/wiki/LLM-WiKi.md`）：完成的学习笔记沉淀为属于你自己的知识库。

## 协议

MIT — 见 [LICENSE](LICENSE)。
