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

  // ---- dialogs ----
  'dialog.tag.confirm': '确认',
  'dialog.tag.input': '输入',
  'dialog.tag.danger': '危险',

  // ---- navigation ----
  'nav.myDay': 'My Day',
  'nav.todo': 'To Do',

  // ---- the agent's presence and the queue ----
  'agent.working': '处理中…',
  'agent.ingesting': '沉淀中…',
  'agent.ready': 'AI 就绪 — Agent 空闲',
  'agent.statusHint': 'Agent 状态 — 打开活动记录',
  'agent.notConfigured': 'AI 未配置',
  'queue.queued.one': '{count} 个任务排队中',
  'queue.queued.other': '{count} 个任务排队中',

  // ---- capture ----
  'task.capture.placeholder': '有什么要做的？',
  'task.capture.ariaLabel': '快速添加任务',

  // ---- task status (the dot-chip) ----
  'task.status.working': '处理中',
  'task.status.ready': '就绪',
  'task.status.failed': '失败',
  'task.status.queued': '排队中',

  // ---- one task: the board row and the AI band ----
  'task.title.edit': '编辑标题',
  'task.type.title': '任务类型',
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
  'task.changeType.title': '更改任务类型？',
  'task.changeType.message': '该任务类型专属的输入会被清空；标题、描述、清单、笔记与完成状态会保留。',
  'task.changeType.confirm': '更改类型',
  'task.finish': '完成',
  'task.finish.failed': '完成失败',
  'task.finishEmpty.title': '还没写笔记就要完成？',
  'task.finishEmpty.message': '你的学习笔记是空的；现在完成，不会有任何内容沉淀进你的 Wiki。',
  'task.finishEmpty.confirm': '仍然完成',

  // ---- the alarm ----
  'task.alarm.label': '闹钟',
  'task.alarm.isSet': '已设闹钟',
  'task.alarm.setHint': '给这个任务设置提醒',
  'task.alarm.setFor': '闹钟设定于 {when}',
  'task.alarm.title': '闹钟 {when}',
  'task.alarm.time': '闹钟时间',

  // ---- the pre-process section of the band ----
  'task.preprocess.title': '预处理',
  'task.preprocess.runNow': '立即运行',
  'task.preprocess.rerun': '重新运行',
  'task.preprocess.failed': '预处理失败',
  'task.preprocess.failedWith': '预处理失败：{error}',
  'task.preprocess.unknownError': '未知错误',
  'task.preprocess.aiNotConfigured': 'AI 未配置 — 请在设置中开启预处理',
  'task.preprocess.emptyHint': '尚未预处理。把任务加入 My Day 即可生成 {kind} 摘要与活动建议，或点击「立即运行」。',
  'task.preprocess.emptyHintNoAi': '尚未预处理。AI 未配置 — 请先在设置中配置模型服务商。',
  'task.preprocess.queued': '排队中…',
  'task.preprocess.summary': '摘要',
  'task.preprocess.analysis': '分析',
  'task.preprocess.suggestions': '建议',
  'task.suggestions.dismiss': '忽略这条建议',
  'task.suggestions.allDismissed': '所有建议都已忽略。',

  // ---- task types ----
  'type.customSuffix': '（自定义）',

  // ---- settings ----
  'settings.appearance.language': '语言',
  'settings.appearance.language.hint': '（立即生效，点击保存后持久化）'
}
