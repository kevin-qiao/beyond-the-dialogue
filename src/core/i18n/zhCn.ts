// 简体中文 catalog.
//
// Annotated with `Catalog` (i.e. `Record<MessageKey, string>`), so TypeScript
// rejects both a missing translation and a key that does not exist in en.ts.
//
// Terminology follows README.zh-CN.md so the app and the README cannot
// disagree: 完成 (Finish), 预处理 (pre-process), 沉淀 (deposit), 工作区 (working
// area), 类型引擎, 工作板. "My Day", "To Do", "Wiki", "JIRA/Confluence",
// "Markdown" and "Agent" stay in English, as that README does.
//
// Full-width punctuation, matching the README.

import type { Catalog } from './en'

export const zhCN: Catalog = {
  // ---- common ----
  'common.listSeparator': '；',
  'common.stepJoiner': ' — ',
  'common.ok': '确定',
  'common.save': '保存',
  'common.saved': '已保存',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.confirm': '确认',
  'common.create': '创建',
  'common.edit': '编辑',
  'common.delete': '删除',
  // 设定 rather than 设置, which is what the Settings drawer is called.
  'common.set': '设定',
  'common.clear': '清除',
  'common.retry': '重试',
  'common.choose': '选择…',
  'common.send': '发送',
  'common.view': '查看',
  'common.remove': '移除',

  // ---- dialogs ----
  'dialog.tag.confirm': '确认',
  'dialog.tag.input': '输入',
  'dialog.tag.danger': '危险',

  // ---- navigation ----
  'nav.myDay': 'My Day',
  'nav.todo': 'To Do',
  'nav.all.empty': '这里还空着。添加一个任务开始吧。',
  'list.create': '新建清单',
  'nav.lists.header': '清单（{count}）',
  'list.rename': '重命名清单',
  'list.delete': '删除清单',
  'list.delete.confirm': '删除「{name}」？其中的 {count} 个任务会变为未分配；任务本身会保留。',
  'list.unassigned': '未分配',


  // ---- the agent's presence and the queue ----
  'agent.working': '处理中…',
  'agent.ingesting': '沉淀中…',
  'agent.ready': 'AI 就绪 — Agent 空闲',
  'agent.statusHint': 'Agent 状态 — 打开活动记录',
  'agent.notConfigured': 'AI 未配置',
  'agent.lastCheckFailed': 'AI 已配置——上次检测失败',
  'queue.queued.one': '{count} 个任务排队中',
  'queue.queued.other': '{count} 个任务排队中',

  // ---- capture ----
  'task.capture.placeholder': '有什么要做的？',
  'task.capture.ariaLabel': '快速添加任务',

  // ---- task status (the dot-chip) ----
  // ready/failed/queued 随预处理流水线一并退役（D4）：唯一还在的状态是用户
  // 亲自启动的任务正在进行。
  'task.status.working': '处理中',

  // ---- one task: the board row and the AI band ----
  'task.title.edit': '编辑标题',
  'task.reopen': '重新打开',
  'task.complete': '完成',
  'task.completedBanner': '完成于 {when}',
  'task.toggle.complete': '标记为完成',
  'task.toggle.incomplete': '标记为未完成',
  'task.cancelJob': '停止正在运行的任务',
  'task.myDay.add': '加入 My Day',
  'task.myDay.remove': '从 My Day 移除',
  'task.myDay.in': '已在 My Day',
  'task.delete.title': '删除任务',
  'task.delete.message': '删除“{title}”？此操作无法撤销。',
  'task.finish': '完成',
  'task.finish.failed': '完成失败',
  // 完成时的双模式选择（D8/FR-003）：按类型指令整理草稿，或原样归档。
  // 只在会出现助手步骤的地方显示。
  'task.finish.modeLabel': '完成方式',
  'task.finish.organize': '整理并归档',
  'task.finish.asWritten': '原样归档',

  // ---- the alarm ----
  'task.alarm.label': '闹钟',
  'task.alarm.isSet': '已设闹钟',
  'task.alarm.setHint': '给这个任务设置提醒',
  'task.alarm.setFor': '闹钟设定于 {when}',
  'task.alarm.title': '闹钟 {when}',
  'task.alarm.time': '闹钟时间',
  'task.alarm.pastTime': '提醒时间必须设在将来',
  'alarm.overdue.title': '过期提醒',
  'alarm.overdue.body': '{title} —— 原定时间为 {when}',

  // 预处理区块与建议 chips 随引擎一并退役（D4）：没有任何界面再读它们。

  // ---- the task column ----
  'nav.search': '搜索（{count}）',
  'nav.rolloverHint': '已完成的任务会在次日清空；未完成的任务继续留在 My Day',
  'nav.progress.done': '项已完成',
  'nav.progress.total': '项 · {pct}%',
  'nav.newTask': '新建任务',
  'nav.allTypes': '全部类型',
  'nav.all': '全部',
  'nav.filterBy': '按 {label} 筛选',
  'nav.empty.search': '没有匹配的任务。',
  'nav.empty.myDay': '今天还没有安排。把任务加入 My Day，开始专注。',
  'nav.empty.todo': 'To Do 还是空的，添加一个任务开始吧。',

  // ---- the task form ----
  'task.field.title': '标题',
  'task.field.titleRequired': '标题不能为空。',
  'task.field.notes': '笔记',
  'task.field.background': '背景',
  'task.field.backgroundPlaceholder': '这项任务为何存在、由来是什么',
  'task.field.target': '目标',
  'task.field.targetPlaceholder': '「完成」应该是什么样子',
  'task.field.notesPlaceholder': '补充说明（可选）',
  'task.field.type': '类型',
  'task.modal.new': '新建',
  'task.modal.editTitle': '编辑任务',
  'task.modal.newTitle': '新建任务',
  'task.save.failed': '无法保存任务',
  'task.inputs.notYetActive': '尚未启用',

  // ---- a proposed remote change ----
  'proposal.ariaLabel': '待确认的远端变更',
  'proposal.heading': '提议的变更 — 尚未发送任何内容',
  'proposal.exactly': '将发送的确切内容',
  'proposal.confirm': '确认并发送',
  'proposal.discard': '放弃',
  'remote.confirmDeferred': 'MCP 传输已对获授权的 Agent 会话生效，但确认驱动的远端执行尚未接入它（研究 R7b、FR-022 第二次修订）—— 该变更未被发送',

  // ---- the focus column and its editor ----
  'focus.empty': '选择一个任务，打开它的 AI 面板与工作区。',
  'focus.workingArea': '工作区',
  'focus.show': '显示任务焦点',
  'focus.hide': '隐藏焦点栏',
  'focus.ai.show': '显示 AI 面板',
  'focus.ai.hide': '隐藏 AI 面板',
  'focus.ai.showLabel': '显示 AI',
  'focus.ai.hideLabel': '隐藏 AI',
  'focus.band.ai': 'AI',
  'focus.band.chat': '对话',
  'editor.write': '编写',
  'editor.preview': '预览',
  'editor.saved': '已保存 {when}',
  'task.notes.placeholder': '补充细节…',

  // ---- progress the main process and the domain emit ----
  'job.step.complete': '完成',
  'finish.step.filingUnpolished': '原样归档',
  'finish.step.noAi': 'AI 未配置',
  'finish.step.organizing': '整理中',
  'finish.step.organizingDetail': '正在重新组织你的草稿',
  'finish.step.depositing': '沉淀中',
  'finish.step.depositingDetail': '正在保全原始素材',
  'finish.step.snapshotting': '快照中',
  'finish.step.snapshottingDetail': '改动前先备份文件',
  'finish.step.curating': '整理中',
  'finish.step.curatingDetail': '助手正在撰写正式笔记',
  'ingest.done': 'Wiki 沉淀完成',

  // ---- toasts the domain raises ----
  'toast.finishDeferred': '任务已完成 — 助手正在整理成文',
  // 完成报告会说明产物去了哪里、走的是哪条路径（FR-003）；
  // 跳过报告是 US1-AC4 的直白陈述。
  'toast.filedOrganized': '已完成 — 整理后归档到 {path}',
  'toast.filedAsWritten': '已完成 — 原样归档到 {path}',
  'toast.organizeSkipped': '整理步骤没有运行 —— 助手处于关闭状态',
  'toast.depositOnly': '已完成 — 你的素材已沉淀；整理步骤没有运行（助手已关闭）',
  'toast.filedUnpolished': '已原样归档 — 助手步骤失败：{error}',

  // ---- refusals the domain states as codes ----
  'validation.unknownInput': '类型“{type}”不认识输入项“{input}”',
  'validation.inputNotString': '输入项“{input}”必须是字符串',
  'validation.inputNotAnOption': '输入项“{input}”必须是以下之一：{options}',
  'validation.inputImmutable': '输入项“{input}”创建后不可更改',
  'validation.keyFormat': '标识必须由小写字母、数字与下划线组成，长度 2–32 位',
  'validation.familyUnknown': '家族必须是以下之一：{families} —— 或者留空表示该类型不需要协助',
  'validation.labelRequired': '名称不能为空',
  'validation.emojiRequired': '表情不能为空',
  'validation.inputSchemaNotArray': 'inputSchema 必须是数组',
  'validation.fieldKeyInvalid': '输入字段标识重复或为空：“{key}”',
  'validation.fieldNeedsLabel': '输入项“{key}”需要一个名称',
  'validation.mustDeclareBehaviour': '类型“{type}”必须声明 finishBehaviour',
  'validation.behaviourUnknown': 'finishBehaviour 必须是以下之一：{behaviours}',
  'validation.completeOnlyNoDestination': 'complete-only 类型不能声明输出位置',
  'validation.needsDestination': '“{behaviour}”类型必须声明一个输出位置',
  'validation.destinationNeedsRoot': '该行为会归档你的成果，输出位置必须有一个地点 —— 请选择它写入的文件夹或知识库',
  'validation.keyIsBuiltin': '“{key}”是内置类型的标识',
  'validation.keyExists': '已存在标识为“{key}”的类型',
  'validation.typeNotFound': '找不到类型“{key}”',
  'validation.builtinFamilyFixed': '内置类型不能更改家族',
  'validation.builtinBehaviourFixed': '内置类型不能更改 finishBehaviour',

  'destination.storeUnknown': '输出存储必须是以下之一：{stores}',
  'destination.folderNeedsAbsoluteRoot': '文件夹类型的输出位置需要绝对路径 rootPath',
  'destination.wikiNeedsRoot': 'Wiki 类型的输出位置需要绝对路径 rootPath —— 不再有可继承的全局 Wiki 位置',
  'destination.subdirNotString': '输出子目录必须是字符串',
  'destination.subdirAbsolute': '输出子目录必须是相对路径，不能是绝对路径',
  'destination.subdirTraversal': '输出子目录不能包含“..”片段',

  'plugin.skill.nameRequired': '技能 #{n}：名称不能为空',
  'plugin.skill.nameUnique': '技能“{name}”：名称必须唯一',
  'plugin.skill.pathRequired': '技能“{name}”：需要来源路径',
  'plugin.mcp.nameRequired': 'MCP 服务器 #{n}：名称不能为空',
  'plugin.mcp.nameUnique': 'MCP 服务器“{name}”：名称必须唯一',
  'plugin.mcp.invalidJson': '不是有效的 JSON：{error}',
  'plugin.mcp.pasteShape': '请粘贴完整的 {"mcpServers": { … }} 配置块，或 { "<名称>": { … } } 形式的服务器映射',
  'plugin.mcp.configNotObject': 'MCP 服务器“{name}”：配置必须是一个对象',
  'plugin.mcp.transportAmbiguous': 'MCP 服务器“{name}”：command、url、socket 必须恰好提供一个',
  'plugin.mcp.argsNotList': 'MCP 服务器“{name}”：args 必须是列表',
  'plugin.mcp.envNotMap': 'MCP 服务器“{name}”：env 必须是名称→值的映射',
  'plugin.mcp.headersNotMap': 'MCP 服务器“{name}”：headers 必须是名称→值的映射',
  'plugin.mcp.cwdNotString': 'MCP 服务器“{name}”：cwd 必须是字符串',

  'skill.github.urlInvalid':
    '不是有效的 GitHub 仓库地址：“{url}” —— 应形如 github.com/<owner>/<repo>，可附加 /tree/<ref>/<subdir>',
  'skill.github.notFound': '找不到 GitHub 仓库：{repo}',
  'skill.github.fetchFailed': '无法下载 {repo}：{error}',
  'skill.github.tooLarge': '仓库压缩包过大（上限：{limit}）',
  'skill.github.badArchive': '下载的压缩包已被拒绝 —— 格式错误或包含不安全路径',
  'skill.github.noSkillMd': '在 {where} 中找不到 SKILL.md —— 请把 URL 指向包含它的文件夹',

  // 「未配置 / 不存在 / 不可用」三个旧码已并入契约的两个码
  // （destination.notConfigured / destination.unreachable，见上）：
  // 两种存储共用同一套拒绝码。
  'artifact.folderNotWritable': '目标文件夹不可写：{path}',
  'artifact.wikiNotWritable': 'Wiki 输出位置不可写：{path}',
  'ingest.typeNotDestined': '类型“{type}”并不归档到 Wiki',
  'ingest.notePathOutside': '笔记路径“{path}”不在当前 Wiki 内 — 请在任务输入中重新指定',

  // ---- feature 002 拒绝码（contracts/document-assist-ipc.md）----
  'destination.notConfigured':
    '该类型还没有输出位置 —— 请在「设置 → 类型」中为它选择归档的文件夹（或知识库），然后重新完成',
  'destination.unreachable': '输出位置已不存在（{path}）—— 请恢复它，或在「设置 → 类型」中为该类型另选位置',
  'document.empty': '还没有写任何内容 —— 请先在工作区写下你的内容，再完成任务',
  'conversation.emptyMessage': '消息是空的 —— 请先写下你的问题',
  'conversation.unavailable.off': '助手运行时已关闭 —— 请在设置中开启后再对话',
  'conversation.unavailable.notConfigured': '尚未配置模型服务 —— 请在设置中添加服务商与密钥后再对话',
  'undo.notDone': '只有已完成的整理才能撤销 —— 这次运行的状态是“{state}”',
  'undo.snapshotMissing': '这次整理保留的状态已丢失（{snapshot}）—— 无法恢复；没有改动任何文件',
  'undo.destinationUnresolved': '知识库位置已无法在类型声明的输出位置下解析 —— 请先恢复它再撤销，以免恢复到错误的地方',

  'finish.noTypeDefinition': '任务“{title}”没有可解析的类型定义',
  'finish.missingInputs': '无法完成：缺少必填输入：{fields}',
  'finish.outsideDestination': '拒绝完成：产物会被写到输出位置之外（{root}）— 请在设置中重新指定',
  'finish.overrideOutside': '“{path}”不在输出位置（{root}）内 — 请在任务输入中重新指定',
  'finish.noBehaviour': '类型“{type}”未声明完成行为 — 请先在设置中设置',
  'finish.noDestination': '类型“{type}”会写入产物，但未声明输出位置 — 请在设置中设置',
  'finish.artifactFailed': '归档失败：{error}',

  // ---- errors the renderer raises itself ----
  'error.mainUnreachable': '无法连接到主进程',
  'error.aiNotConfigured': 'AI 未配置：请在设置中配置服务商、模型与 API 密钥',
  'error.unknown': '未知错误',

  // ---- 任务对话界面（feature 002, US2）----
  // 调试对话的键随抽屉一并退役（T027）：对话现在是任务所有的持久状态。
  'chat.listLabel': '对话',
  'chat.new': '新对话',
  'chat.conversationLabel': '对话 {n}',
  'chat.delete': '删除这个对话',
  'chat.sendFailed': '回复失败 —— 已保存的历史记录完好无损',
  'chat.emptyHint': '问问这个任务 —— 回复会以任务自身的材料为依据',
  'chat.replying': '模型正在回复…',
  'chat.placeholder': '给助手发消息…（回车发送）',

  // ---- the top bar ----
  'app.loading': '加载中…',
  'today.label': '今天',
  'today.progress': 'My Day · 已完成 {done}/{total}',
  'palette.hint': '命令面板（{mod}）— 点击图标或按 {mod}',
  'search.placeholder': '搜索任务、笔记、摘要…',
  'search.clear': '清除',
  'nav.activityHint': '活动 — Agent 的工作',
  'nav.theme.toDark': '切换到深色主题',
  'nav.theme.toLight': '切换到浅色主题',

  // ---- the drawers ----
  'drawer.activity.title': '活动',
  'drawer.activity.sub': 'Agent 任务 · 沉淀记录 · 实时进度',
  'drawer.settings.title': '设置',
  'drawer.settings.sub': 'AI 服务商 · 主题 · 偏好',

  // ---- activity: jobs and ingest records ----
  'activity.sub': 'Agent 的工作 — 实时',
  'activity.empty': '还没有正在运行的工作。把类型任务加入 My Day 即可预处理，或完成一个任务把写下的内容归档。',
  'activity.jobs': '正在运行与最近的任务',
  'activity.finished': '已完成的工作',
  'job.kind.preprocess': '预处理',
  'job.kind.suggestion': '建议',
  'job.kind.ingest': 'Wiki 沉淀',
  'job.state.queued': '排队中',
  'job.state.running': '运行中',
  'job.state.done': '完成',
  'job.state.failed': '失败',
  'job.state.unpolished': '完成 — 未润色',
  'job.step': '步骤：{label}',
  'job.autoRetryPending': '等待自动重试',
  'job.autoRetryAttempt': '自动重试（第 {n}/3 次）',
  'job.deposited': '已沉淀：{files}',
  'job.filesWritten': '已写入文件：{files}',

  // ---- the JIRA / Confluence working area ----
  'jira.source.issue': 'JIRA 工单内容',
  'jira.source.page': 'Confluence 页面内容',
  'jira.source.hint': '粘贴的来源 · 只读',
  'jira.source.empty': '还没有来源内容 — 右键该任务，选择 ✎ 编辑，粘贴工单或页面内容。',
  'jira.drafts.title': '评论草稿',
  'jira.drafts.hint': '仅保存在本地 · 当前版本不会发布任何内容',
  'jira.drafts.placeholder': '为工单/页面起草一条评论…',
  'jira.draft.failed': '无法保存评论草稿',

  // ---- the command palette ----
  'palette.ariaLabel': '命令面板',
  'palette.placeholder': '输入以搜索任务、类型或动作…',
  'palette.empty': '没有匹配「{q}」的结果',
  'palette.untitled': '（未命名）',
  'palette.action.newTask.sub': '聚焦快速添加输入框',
  'palette.action.settings': '打开设置',
  'palette.action.settings.sub': '类型、AI、主题',
  'palette.action.activity': '打开活动',
  'palette.action.activity.sub': 'Agent 任务进度',
  'palette.action.today': '前往 My Day',
  'palette.action.today.sub': '切换到 My Day 视图',
  'palette.action.theme': '切换主题',
  'palette.action.theme.toDark': '当前浅色 → 深色',
  'palette.action.theme.toLight': '当前深色 → 浅色',
  'palette.theme.notified': '已切换到{theme}主题',
  'palette.theme.dark': '深色',
  'palette.theme.light': '浅色',
  'palette.group.actions': '动作',
  'palette.group.tasks': '任务',
  'palette.group.types': '类型',
  'palette.type.builtin': '内置',
  'palette.type.custom': '自定义',
  'palette.type.notifyBuiltin': '内置类型「{label}」',
  'palette.type.notifyCustom': '类型「{label}」已存在',

  // ---- the first-run welcome ----
  'welcome.title': '欢迎使用 Beyond the Dialogue',
  'welcome.sub': '一块待办工作板：AI Agent 与你一起推进每一类任务，并把结果沉淀进你个人的 Wiki。',
  'welcome.openSettings': '打开设置',
  'welcome.step1.title': '1 · 选择任务类型',
  'welcome.step1.body': '学习、JIRA/Confluence、普通任务，或者你自己的类型 — 每个类型都声明自己的输入与 AI 流程。',
  'welcome.step2.title': '2 · 与 Agent 协作',
  'welcome.step2.body': '把任务加入 My Day，Agent 就会预处理：工作提示、摘要与活动建议。',
  'welcome.step3.title': '3 · 完成 → 自动归档进你的 Wiki',
  'welcome.step3.body': '完成的学习笔记会落进你的 Wiki（可直接用 Obsidian 打开）；索引与日志自动更新。请先在设置中把学习类型的输出位置指向一个 Wiki 目录。',
  'welcome.connect': '先接入一个 AI 服务商',
  'welcome.saveAndStart': '保存并开始',
  'welcome.trySample': '试试一个示例学习任务 →',
  'welcome.skip': '跳过 — 直接看工作板（普通任务不需要 AI）',
  'welcome.sample.title': '线性代数复习',
  'welcome.sample.target': '特征值，以及它为什么重要',

  // ---- task types ----
  'type.customSuffix': '（自定义）',

  // 内置类型的初始展示。db.ts 用这些字符串写入数据库，渲染层则靠比对它们
  // 判断某个类型是否仍未被用户改名 — 所以这里的文本是契约，而不只是展示。
  'type.plain.label': '普通任务',
  // 002：描述不再提及已退役的引擎；v13 迁移会按旧文本改写内置行，
  // 保证「仍为默认」的比对继续成立。
  'type.plain.description': '普通任务 — 不声明任何协助，只有笔记',
  'type.document.label': '文档',
  'type.document.description': '在工作区写作；完成时归档到类型声明的位置 —— 按你的指令整理，或原样归档',
  // type.learning.* 是迁移时代的键（v3/v4 仍在读字段名）；label/description
  // 保留的原因相同 —— 那个时代写入的行仍靠与目录比对来识别「是否仍为默认」。
  // learning/jira/meeting 内置类型已由 v13 删除；jira/meeting 的键随种子与
  // schema 一并清理。
  'type.learning.label': '学习',
  'type.learning.description': '学习一个概念：AI 提示 + 摘要，Markdown 笔记，完成时沉淀进 Wiki',
  'type.learning.field.target.label': '学习目标',
  'type.learning.field.target.placeholder': '要学习的概念或问题',
  'type.learning.field.filePath.label': '附件',
  'type.learning.field.filePath.placeholder': '可选的 Markdown（.md）附件',
  'type.learning.field.purpose.label': '提示词',
  'type.learning.field.purpose.placeholder': '你希望学习笔记覆盖的内容（会注入学习提示词）',
  'type.learning.field.learningNotePath.label': '笔记路径',
  'type.learning.field.learningNotePath.placeholder': '默认位于 Wiki 内部',

  // ---- settings ----
  'settings.sections': '设置分区',
  'settings.tab.general': '通用',
  'settings.tab.types': '类型',
  'settings.tab.plugins': '插件',
  'settings.tab.ai': 'AI',
  'settings.appearance.title': '外观',
  'settings.theme': '主题',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.appearance.language': '语言',
  'settings.appearance.language.hint': '（立即生效，点击保存后持久化）',
  'settings.ai.title': 'AI 服务商',
  'settings.ai.provider': '服务商',
  'settings.ai.model': '模型',
  'settings.ai.apiKey': 'API 密钥',
  'settings.ai.apiKey.hint': '（保存在应用的私有数据目录）',
  'settings.ai.test': '测试连接',
  'settings.ai.testing': '测试中…',
  'settings.ai.connected': '已连接 — 模型回复：{text}',
  'settings.ai.failed': '失败：{error}',
  'settings.ai.configured': 'AI 已配置 · {provider} / {model}',
  'settings.ai.noModel': '未指定模型',
  'settings.ai.notConfigured': 'AI 未配置 — 非 AI 功能仍可正常使用。可在 AI 标签页配置。',
  'settings.types.builtin.title': '内置类型',
  'settings.types.builtin.hint': '可编辑展示，行为固定',
  'settings.types.custom.title': '自定义类型',
  'settings.types.new': '新建类型',
  'settings.types.editPresentation': '编辑展示',
  'settings.types.empty.title': '还没有自定义类型',
  'settings.types.empty.body': '点击「＋ 新建类型」，用一个内置行为类型包上你自己的名称、表情和输入字段。',
  'settings.plugins.disable': '禁用此项——禁用期间任何会话都不能经由它触达外部',
  'settings.plugins.enable': '重新启用此项',
  'settings.plugins.disabled': '已禁用',
  'settings.plugins.enabled': '已启用',
  'settings.plugins.inert': '技能会被导入应用的技能目录，但 Agent 尚未加载它们。你添加的 MCP 服务器会接入已授权类型的交互会话，并写入应用自己的 mcp.json。',
  'settings.plugins.saveFailed': '保存失败：{error}',
  'settings.ai.checkFailed': '{provider} {model} — 已配置，但上次检测失败（{reason}）',
  'settings.plugins.removeSkill.title': '移除技能',
  'settings.plugins.removeSkill.message': '移除技能「{name}」？',
  'settings.plugins.removeServer.title': '移除 MCP 服务器',
  'settings.plugins.removeServer.message': '移除 MCP 服务器「{name}」？',
  'settings.skills.title': '技能',
  'settings.skills.hint': '已导入 · Agent 尚未加载',
  'settings.skills.nameKey': '名称即标识',
  'settings.skills.noDescription': '无描述',
  'settings.skills.empty': '还没有技能',
  'settings.skills.emptyBody': '导入一个包含 SKILL.md 的文件夹即可添加技能。',
  'settings.skills.import': '导入技能文件夹',
  'settings.skills.importing': '导入中…',
  'settings.skills.importFailed': '无法导入该技能文件夹',
  'settings.skills.exists': '技能「{name}」已存在 — 名称必须唯一',
  'settings.skills.githubImport': '从 GitHub 导入',
  'settings.skills.githubPlaceholder': 'https://github.com/owner/repo — 可附加 /tree/分支/子目录',
  'settings.skills.githubImportFailed': '无法从 GitHub 导入',
  'settings.mcp.title': 'MCP 服务器',
  'settings.mcp.hint': '粘贴标准 mcp.json 的服务器配置',
  'settings.mcp.empty': '还没有 MCP 服务器',
  'settings.mcp.pastePlaceholder': '{"mcpServers": { "名称": { "command": "npx", "args": ["-y", "some-mcp-server"] } }}',
  'settings.mcp.addJson': '添加服务器',
  'settings.mcp.emptyPaste': '请先粘贴服务器配置',
  'settings.mcp.exists': 'MCP 服务器「{name}」已存在 — 名称必须唯一',
  'settings.mcp.mcpJsonNote': '这些服务器也会自动写入应用的 mcp.json（一份供查看的副本 — Agent 读取的是它自己的设置）。',
  'settings.mcp.trustNote': '你添加的服务器以你自己的权限运行 — 应用不会自行调用其命令、env 助手或凭据。',
  'settings.mcp.materializeFailed': 'MCP 服务器已保存，但写入 mcp.json 失败：{error}',

  // ---- what each finish behaviour does (FR-014) ----
  'finishBehaviour.completeOnly': '仅完成 — 不写入任何内容',
  'finishBehaviour.fileAsIs': '原样归档 — 原封不动保存你的内容',
  // 重新论证为通用整理步骤（research D2）：不再带会议框架。
  'finishBehaviour.polishThenFile': '先整理再归档 — 助手按你的指令整理草稿，然后归档',
  'finishBehaviour.depositThenCurate': '先沉淀再整理 — 先把你的素材保全进知识库，再由助手整理合集',

  // ---- the workflow-type editor ----
  'typeEditor.newTag': '新建',
  'typeEditor.editTag': '编辑',
  'typeEditor.newTitle': '新建类型',
  'typeEditor.editBuiltin': '编辑内置类型的展示',
  'typeEditor.editTitle': '编辑类型',
  'typeEditor.key': '标识（Key）',
  'typeEditor.keyPlaceholder': '例如 code_review',
  'typeEditor.emoji': '表情',
  'typeEditor.label': '名称',
  'typeEditor.labelPlaceholder': '例如 代码评审',
  'typeEditor.description': '描述',
  'typeEditor.descriptionPlaceholder': '这个类型用来做什么',
  'typeEditor.family': '家族',
  'typeEditor.family.none': '无家族 — 不需要协助的类型',
  'typeEditor.family.document': 'document — 在工作区写作，完成时整理并归档',
  'typeEditor.family.workingSystem': 'working-system — 外部工作系统（尚未启用）',
  'typeEditor.family.coding': 'coding — 以代码为中心的协助（尚未启用）',
  'typeEditor.family.noneHint': '没有家族的类型不会有助手步骤：完成时只按声明执行或归档。',
  'typeEditor.family.documentHint': '文档类型在工作区写作；完成时可选「整理并归档」或「原样归档」。',
  'typeEditor.family.notLiveHint': '该家族还没有启用的协助 — 类型可以保存，但在其对应功能落地前按无家族方式工作。',
  'typeEditor.fields': '声明的输入项',
  'typeEditor.fieldsHint': '该类型任务需要填写的字段。留空表示任务只带标题、背景、目标与工作区。',
  'typeEditor.fieldKeyPlaceholder': '标识',
  'typeEditor.fieldLabelPlaceholder': '任务上显示的名称',
  'typeEditor.fieldType.text': '单行文本',
  'typeEditor.fieldType.textarea': '多行文本',
  'typeEditor.fieldType.url': '链接',
  'typeEditor.fieldType.file': '文件',
  'typeEditor.fieldRequired': '必填',
  'typeEditor.fieldRemove': '删除这个字段',
  'typeEditor.fieldAdd': '添加字段',
  'typeEditor.fieldDuplicate': '输入字段标识重复：“{key}”',
  'typeEditor.aiGuidance': '助手指令',
  'typeEditor.aiGuidanceHint': '（可选 — 整理步骤会遵循这条指令）',
  'typeEditor.aiGuidancePlaceholder': '例如：把我的日记按日期前缀归档，保留心情小节。',
  'typeEditor.finishBehaviour': '完成行为',
  'typeEditor.finishFixed': '内置类型固定不可改',
  'typeEditor.finishHint': '按下该类型任务的「完成」时，你的内容会如何处理。',
  'typeEditor.destination': '输出位置',
  'typeEditor.dest.folder': '我自己的文件夹',
  'typeEditor.dest.wiki': 'Wiki',
  'typeEditor.subfolder': '子目录',
  'typeEditor.subfolderHint': '（可选，相对路径）',
  'typeEditor.folderHint': '纯 Markdown 文件会写到这里；不会写入其他内容，也不会覆盖已有文件。',
  'typeEditor.wikiResolved': '解析为 {dest} — 首次使用时会在该目录创建 Wiki 所需结构；你已有的文件不会被覆盖。',
  // 授权/能力相关键随授权区块一并删除（D9）：一个什么都不改变的控件，
  // 会让用户对自己的控制力产生错误认知。
  'typeEditor.keyRequired': '标识不能为空',
  'typeEditor.keyFormat': '标识只能用小写字母、数字与下划线（2–32 个字符）',
  'typeEditor.keyTaken': '标识「{key}」已被使用',
  'typeEditor.labelRequired': '名称不能为空',
  'typeEditor.emojiRequired': '表情不能为空',
  'typeEditor.needsFolder': '该行为会写入文件，因此需要一个目标文件夹',
  'typeEditor.subfolderRelative': '子目录必须是相对路径，且不能包含「..」',
  'typeEditor.deleteTag': '删除',
  'typeEditor.deleteTitle': '删除类型「{label}」？',
  'typeEditor.deleteInUse': '有 {count} 个任务正在使用该类型。它们会回退为 plain；标题、笔记、清单与完成状态都会保留。',
  'typeEditor.deleteUnused': '目前没有任务使用该类型。',
  'typeEditor.deleteHint': '该类型会从选择器与这里的设置列表中移除。',
  'typeEditor.deleteConfirm': '删除类型',

  // ---- assistant runtime switch (feature 001, research D1) ----
  'assistant.disabled': 'AI 辅助已关闭——请在设置中开启助手运行时后才能使用',

  // ---- attachments (feature 001, FR-002/FR-003) ----
  'attachment.title': '文件',
  'attachment.add': '添加文件',
  'attachment.added': '文件已添加',
  'attachment.addFailed': '无法添加该文件',
  'attachment.remove': '移除',
  'attachment.open': '打开',
  'attachment.none': '尚未添加任何文件。',
  'attachment.tooLarge': '该文件太大，无法添加（上限为 {limit}）',
  'attachment.unreadable': '无法读取该文件',
  'attachment.missing': '此附件的应用内副本在数据目录中缺失',

  // ---- secrets: write-only fields and the moved-folder state (FR-020/FR-021) ----
  'settings.secret.set': '已保存——密钥值不会再显示出来',
  'settings.secret.stored': '已保存——留空即保持不变',
  'settings.secret.reenterRequired': '该服务是在另一台机器上配置的；请重新输入密钥才能在本机使用'
}
