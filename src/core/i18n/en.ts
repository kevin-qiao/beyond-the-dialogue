// The English catalog — and the single declaration of the message key set.
//
// THE VERBATIM RULE: every value here is the literal the app used before it was
// translated, character for character. Two things depend on it:
//
//   1. `displayTypeLabel` and friends decide whether a seeded type label is
//      still the default by comparing the stored value against these strings,
//      so a seeded type translates only while the user has not renamed it.
//   2. Changing a value changes what users see for a string they may have been
//      reading for months, which is a product decision rather than a tidy-up.
//
// The only permitted edit while translating a literal into a key is turning
// interpolation into a `{param}` hole.
//
// This file is also the key set's type: `MessageKey` is derived from it, and
// zhCn.ts is annotated with `Catalog`, so a missing or misspelled Chinese key
// is a compile error in `npm run typecheck` rather than a blank label at runtime.

export const en = {
  // ---- common ----
  'common.listSeparator': '; ',
  'common.stepJoiner': ' — ',
  'common.ok': 'OK',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.create': 'Create',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.set': 'Set',
  'common.clear': 'Clear',
  'common.retry': 'Retry',

  // ---- dialogs ----
  'dialog.tag.confirm': 'Confirm',
  'dialog.tag.input': 'Input',
  'dialog.tag.danger': 'Danger',

  // ---- navigation ----
  // My Day and To Do keep their English names in every language: they are the
  // product's own terms, and the Chinese README uses them as they are.
  'nav.myDay': 'My Day',
  'nav.todo': 'To Do',

  // ---- the agent's presence and the queue ----
  'agent.working': 'working…',
  'agent.ingesting': 'ingesting…',
  'agent.ready': 'AI ready — agent idle',
  'agent.statusHint': 'Agent status — open Activity',
  'agent.notConfigured': 'AI not configured',
  'queue.queued.one': '{count} job queued',
  'queue.queued.other': '{count} jobs queued',

  // ---- capture ----
  'task.capture.placeholder': 'What needs doing?',
  'task.capture.ariaLabel': 'Quick add task',

  // ---- task status (the dot-chip) ----
  'task.status.working': 'working',
  'task.status.ready': 'ready',
  'task.status.failed': 'failed',
  'task.status.queued': 'queued',

  // ---- one task: the board row and the AI band ----
  'task.title.edit': 'Edit title',
  'task.type.title': 'Task type',
  'task.reopen': 'Reopen',
  'task.complete': 'Complete',
  'task.completedBanner': 'Completed {when}',
  'task.toggle.complete': 'Mark complete',
  'task.toggle.incomplete': 'Mark incomplete',
  'task.cancelJob': 'Stop the running job',
  'task.myDay.add': 'Add to My Day',
  'task.myDay.remove': 'Remove from My Day',
  'task.myDay.in': 'In My Day',
  'task.delete.title': 'Delete task',
  'task.delete.message': 'Delete "{title}"? This cannot be undone.',
  'task.changeType.title': 'Change task type?',
  'task.changeType.message':
    'The type-specific inputs will be cleared for this task. Title, description, list, notes, and completion are kept.',
  'task.changeType.confirm': 'Change type',
  'task.finish': 'Finish',
  'task.finish.failed': 'Finish failed',
  'task.finishEmpty.title': 'Finish without notes?',
  'task.finishEmpty.message':
    'Your learning note is empty. Nothing meaningful will be ingested to your wiki if you finish now.',
  'task.finishEmpty.confirm': 'Finish anyway',

  // ---- the alarm ----
  'task.alarm.label': 'Alarm',
  'task.alarm.isSet': 'Alarm set',
  'task.alarm.setHint': 'Set a reminder for this task',
  'task.alarm.setFor': 'Alarm set for {when}',
  'task.alarm.title': 'Alarm {when}',
  'task.alarm.time': 'Alarm time',

  // ---- the pre-process section of the band ----
  'task.preprocess.title': 'Pre-process',
  'task.preprocess.runNow': 'Run now',
  'task.preprocess.rerun': 'Re-run',
  'task.preprocess.failed': 'Pre-process failed',
  'task.preprocess.failedWith': 'Pre-process failed: {error}',
  'task.preprocess.unknownError': 'unknown error',
  'task.preprocess.aiNotConfigured': 'AI not configured — open Settings to enable pre-processing',
  'task.preprocess.emptyHint':
    'No pre-process yet. Add this task to My Day to generate the {kind} summary and suggestions, or click Run now.',
  'task.preprocess.emptyHintNoAi': 'No pre-process yet. AI is not configured — set up a provider in Settings first.',
  'task.preprocess.queued': 'queued…',
  'task.preprocess.summary': 'Summary',
  'task.preprocess.analysis': 'Analysis',
  'task.preprocess.suggestions': 'Suggestions',
  'task.suggestions.dismiss': 'Dismiss this suggestion',
  'task.suggestions.allDismissed': 'All suggestions dismissed.',

  // ---- task types ----
  // The suffix a custom type's name carries wherever types are listed.
  'type.customSuffix': '（custom）',

  // ---- settings ----
  'settings.appearance.language': 'Language',
  'settings.appearance.language.hint': '(applies immediately, saved on Save)'
} satisfies Record<string, string>

export type MessageKey = keyof typeof en

/**
 * Every language's catalog must carry exactly these keys. Annotating the other
 * catalogs with this type is what enforces coverage.
 */
export type Catalog = Record<MessageKey, string>
