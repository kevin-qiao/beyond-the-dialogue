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

  // ---- settings ----
  'settings.appearance.language': '语言',
  'settings.appearance.language.hint': '（立即生效，点击保存后持久化）'
}
