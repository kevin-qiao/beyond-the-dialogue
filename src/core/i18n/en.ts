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
  'common.saved': 'Saved',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.create': 'Create',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.set': 'Set',
  'common.clear': 'Clear',
  'common.retry': 'Retry',
  'common.choose': 'Choose…',
  'common.send': 'Send',
  'common.view': 'View',
  'common.remove': 'Remove',

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

  // ---- the task column ----
  'nav.search': 'Search ({count})',
  'nav.rolloverHint': 'Completed tasks clear at the next day; open tasks stay in My Day',
  'nav.progress.done': 'done',
  'nav.progress.total': 'total · {pct}%',
  'nav.newTask': 'New task',
  'nav.allTypes': 'All types',
  'nav.all': 'All',
  'nav.filterBy': 'Filter by {label}',
  'nav.empty.search': 'No tasks match your search.',
  'nav.empty.myDay': 'Nothing planned for today. Add a task to My Day to get focused.',
  'nav.empty.todo': 'To Do is empty. Add a task to get started.',

  // ---- the task form ----
  'task.field.title': 'Title',
  'task.field.titleRequired': 'Title is required.',
  'task.field.notes': 'Notes',
  'task.field.notesPlaceholder': 'Optional details',
  'task.field.type': 'Type',
  'task.modal.new': 'New',
  'task.modal.editTitle': 'Edit task',
  'task.modal.newTitle': 'New task',
  'task.save.failed': 'Could not save the task',
  'task.inputs.notYetActive': 'not yet active',

  // ---- a proposed remote change ----
  'proposal.ariaLabel': 'Proposed remote changes',
  'proposal.heading': 'Proposed change — nothing has been sent yet',
  'proposal.exactly': 'Exactly what will be sent',
  'proposal.confirm': 'Confirm and send',
  'proposal.discard': 'Discard',
  'remote.confirmDeferred':
    'The MCP transport is live for granted agent sessions, but confirmation-driven remote execution is not yet wired to it (research R7b, FR-022 second amendment) — the change was not sent',

  // ---- the focus column and its editor ----
  'focus.empty': 'Select a task to open its AI band and working area.',
  'focus.show': 'Show task focus',
  'focus.hide': 'Hide focus column',
  'focus.ai.show': 'Show AI band',
  'focus.ai.hide': 'Hide AI band',
  'focus.ai.showLabel': 'show AI',
  'focus.ai.hideLabel': 'hide AI',
  'editor.write': 'Write',
  'editor.preview': 'Preview',
  'editor.chat': 'Chat',
  'editor.saved': 'saved {when}',
  'task.notes.placeholder': 'Add details…',

  // ---- progress the main process and the domain emit ----
  // Written to `jobs.step_label` and shown in the Activity drawer. Produced
  // already-localised rather than translated on display: the column holds what
  // happened, and a key stored in it would render as a key on every old row.
  'job.step.complete': 'Complete',
  'finish.step.filingUnpolished': 'Filing unpolished',
  'finish.step.noAi': 'AI not configured',
  'finish.step.polishing': 'Polishing',
  'finish.step.polishingDetail': 'Re-organizing the minutes',
  'finish.step.depositing': 'Depositing',
  'finish.step.depositingDetail': 'Preserving the raw material',
  'finish.step.snapshotting': 'Snapshotting',
  'finish.step.snapshottingDetail': 'Backing up files before changes',
  'finish.step.curating': 'Curating',
  'finish.step.curatingDetail': 'The assistant is writing the finished note',
  'preprocess.step.running': 'Pre-processing',
  'preprocess.step.learning': 'Generating learning summary',
  'preprocess.step.jira': 'Summarizing pasted content',
  'preprocess.step.meeting': 'Proposing an agenda',
  'preprocess.done': 'Pre-process complete',
  'suggest.step.running': 'Suggesting',
  'suggest.step.detail': 'Generating suggestions',
  'suggest.done.one': '{count} suggestion generated',
  'suggest.done.other': '{count} suggestions generated',
  'ingest.done': 'Wiki ingestion complete',

  // ---- toasts the domain raises ----
  'toast.finishDeferred': 'Task finished — the assistant is writing it up',
  'toast.filedTo': 'Finished — filed to {path}',
  'toast.filedUnpolished': 'Filed as written — the assistant step failed: {error}',

  // ---- refusals the domain states as codes ----
  // Validated in src/core (which has no language) and phrased where the
  // language is known — the renderer, or the main process before it crosses
  // the IPC boundary. The English text is what these messages have always read.
  'validation.unknownInput': 'unknown input "{input}" for type "{type}"',
  'validation.inputNotString': 'input "{input}" must be a string',
  'validation.inputNotAnOption': 'input "{input}" must be one of: {options}',
  'validation.inputImmutable': 'input "{input}" cannot be changed after creation',
  'validation.keyFormat': 'key must be 2–32 chars of lowercase letters, digits, underscore',
  'validation.kindUnknown': 'kind must be one of: {kinds}',
  'validation.labelRequired': 'label is required',
  'validation.emojiRequired': 'emoji is required',
  'validation.inputSchemaNotArray': 'inputSchema must be an array',
  'validation.fieldKeyInvalid': 'duplicate or empty input field key "{key}"',
  'validation.fieldNeedsLabel': 'input "{key}" needs a label',
  'validation.mustDeclareBehaviour': 'a "{kind}" type must declare a finishBehaviour',
  'validation.behaviourUnknown': 'finishBehaviour must be one of: {behaviours}',
  'validation.completeOnlyNoDestination': 'a complete-only type must not declare a destination',
  'validation.needsDestination': 'a "{behaviour}" type must declare a destination',
  'validation.grantsNotArrays': 'grant entries must be arrays of names',
  'validation.grantNamesEmpty': 'grant names must be non-empty strings',
  'validation.keyIsBuiltin': '"{key}" is a built-in type key',
  'validation.keyExists': 'a type with key "{key}" already exists',
  'validation.typeNotFound': 'type "{key}" not found',
  'validation.builtinKindFixed': 'built-in types cannot change kind',
  'validation.builtinBehaviourFixed': 'built-in types cannot change finishBehaviour',

  'destination.storeUnknown': 'destination store must be one of: {stores}',
  'destination.folderNeedsAbsoluteRoot': 'a folder destination requires an absolute rootPath',
  'destination.wikiNeedsRoot': 'a wiki destination requires an absolute rootPath — there is no global wiki location to inherit',
  'destination.subdirNotString': 'destination subdir must be a string',
  'destination.subdirAbsolute': 'destination subdir must be relative, not absolute',
  'destination.subdirTraversal': 'destination subdir must not contain a ".." segment',

  'plugin.skill.nameRequired': 'skill #{n}: name is required',
  'plugin.skill.nameUnique': 'skill "{name}": name must be unique',
  'plugin.skill.pathRequired': 'skill "{name}": a source path is required',
  'plugin.mcp.nameRequired': 'MCP server #{n}: name is required',
  'plugin.mcp.nameUnique': 'MCP server "{name}": name must be unique',
  'plugin.mcp.invalidJson': 'not valid JSON: {error}',
  'plugin.mcp.pasteShape':
    'paste a complete {"mcpServers": { … }} block, or a { "<name>": { … } } map of server configs',
  'plugin.mcp.configNotObject': 'MCP server "{name}": its configuration must be an object',
  'plugin.mcp.transportAmbiguous': 'MCP server "{name}": exactly one of command, url, or socket is required',
  'plugin.mcp.argsNotList': 'MCP server "{name}": args must be a list',
  'plugin.mcp.envNotMap': 'MCP server "{name}": env must be a name→value map',
  'plugin.mcp.headersNotMap': 'MCP server "{name}": headers must be a name→value map',
  'plugin.mcp.cwdNotString': 'MCP server "{name}": cwd must be a string',

  'skill.github.urlInvalid':
    'not a GitHub repository URL: "{url}" — expected github.com/<owner>/<repo>, optionally followed by /tree/<ref>/<subdir>',
  'skill.github.notFound': 'GitHub repository not found: {repo}',
  'skill.github.fetchFailed': 'could not download {repo}: {error}',
  'skill.github.tooLarge': 'the repository archive is too large (limit: {limit})',
  'skill.github.badArchive': 'the downloaded archive was refused — it is malformed or contains an unsafe path',
  'skill.github.noSkillMd': 'no SKILL.md found in {where} — point the URL at the folder that contains it',

  'artifact.destinationUnset': 'destination is not configured',
  'artifact.folderMissing': 'destination folder does not exist: {path} — create it or choose another in Settings',
  'artifact.folderNotWritable': 'destination folder is not writable: {path}',
  'artifact.wikiUnusable': 'wiki destination is not usable: {error}',
  'artifact.wikiNotWritable': 'wiki destination is not writable: {path}',
  'wiki.notConfigured': 'no wiki directory is configured for this type — edit the type in Settings (Types) and set its destination',
  'ingest.typeNotDestined': 'type "{type}" is not destined for the wiki',
  'ingest.notePathOutside': 'learning-note path "{path}" is outside the current wiki — re-point it in the task inputs',
  'preprocess.noPreprocess': 'this task type has no pre-process',
  'finish.noTypeDefinition': 'no type definition resolves for task "{title}"',
  'finish.missingInputs': 'cannot finish: missing required input(s): {fields}',
  'finish.outsideDestination': 'refusing to finish: the artifact would be written outside the destination root ({root}) — re-point the destination in Settings',
  "finish.overrideOutside": "\"{path}\" is outside the destination ({root}) — re-point it in the task's inputs",
  'finish.noBehaviour': 'type "{type}" does not declare a finish behaviour — set one in Settings before finishing',
  'finish.noDestination': 'type "{type}" writes an artifact but declares no destination — set one in Settings',
  'finish.artifactFailed': 'Filing failed: {error}',

  // ---- errors the renderer raises itself ----
  'error.mainUnreachable': 'Could not reach the main process',
  'error.aiNotConfigured': 'AI not configured: open Settings to configure a provider, model and API key',

  // ---- the chat ----
  'chat.title': 'Chat',
  'chat.newConversation': 'New conversation',
  'chat.debugIntro': 'Debug: talk to your configured model to verify the connection and model behavior.',
  'chat.debugEmpty':
    'No messages yet. Say hello, or ask the model to describe itself — anything that confirms the provider is reachable.',
  'chat.emptyHint': 'Ask the agent anything',
  'chat.replying': 'The model is replying…',
  'chat.placeholder': 'Message the agent… (Enter to send)',

  // ---- the top bar ----
  'app.loading': 'Loading…',
  'today.label': 'today',
  'today.progress': 'My Day · {done}/{total} done',
  'palette.hint': 'Command palette ({mod}) — click the icon or {mod}',
  'search.placeholder': 'Search tasks, notes, summaries…',
  'search.clear': 'clear',
  'nav.activityHint': 'Activity — agent work',
  'nav.theme.toDark': 'Switch to dark theme',
  'nav.theme.toLight': 'Switch to light theme',

  // ---- the drawers ----
  'drawer.activity.title': 'Activity',
  'drawer.activity.sub': 'agent jobs · ingest history · live progress',
  'drawer.settings.title': 'Settings',
  'drawer.settings.sub': 'ai provider · theme · preferences',
  'drawer.chat.title': 'Debug chat',
  'drawer.chat.sub': 'agent session · stream events',

  // ---- activity: jobs and ingest records ----
  'activity.sub': 'Agent work — live',
  'activity.empty': 'Nothing running yet. Add a typed task to My Day to pre-process it, or finish one to file what you wrote.',
  'activity.jobs': 'Running & recent jobs',
  'activity.finished': 'Finished work',
  'job.kind.preprocess': 'Pre-process',
  'job.kind.suggestion': 'Suggestions',
  'job.kind.ingest': 'Wiki ingestion',
  'job.state.queued': 'queued',
  'job.state.running': 'running',
  'job.state.done': 'done',
  'job.state.failed': 'failed',
  'job.state.unpolished': 'done — unpolished',
  'job.step': 'step: {label}',
  'job.autoRetryPending': 'auto-retry pending',
  'job.autoRetryAttempt': 'auto-retry (attempt {n}/3)',
  'job.deposited': 'Deposited: {files}',
  'job.filesWritten': 'Files written: {files}',

  // ---- the JIRA / Confluence working area ----
  'jira.source.issue': 'JIRA issue content',
  'jira.source.page': 'Confluence page content',
  'jira.source.hint': 'pasted source · read-only',
  'jira.source.empty': 'No source content yet — right-click this task, choose ✎ Edit, and paste the issue/page content.',
  'jira.drafts.title': 'Comment drafts',
  'jira.drafts.hint': 'saved locally · nothing is posted in this version',
  'jira.drafts.placeholder': 'Draft a comment for the issue/page…',
  'jira.draft.failed': 'Could not save the comment draft',

  // ---- the command palette ----
  'palette.ariaLabel': 'Command palette',
  'palette.placeholder': 'Search tasks, types or actions…',
  'palette.empty': 'No results for “{q}”',
  'palette.untitled': '(untitled)',
  'palette.action.newTask.sub': 'Focus the quick-add input',
  'palette.action.settings': 'Open settings',
  'palette.action.settings.sub': 'Types, AI, theme',
  'palette.action.activity': 'Open activity',
  'palette.action.activity.sub': 'Agent job progress',
  'palette.action.chat': 'Open debug chat',
  'palette.action.chat.sub': 'Talk to the model directly',
  'palette.action.today': 'Go to My Day',
  'palette.action.today.sub': 'Switch to the My Day view',
  'palette.action.theme': 'Toggle theme',
  'palette.action.theme.toDark': 'Currently light → dark',
  'palette.action.theme.toLight': 'Currently dark → light',
  'palette.theme.notified': 'Switched to the {theme} theme',
  'palette.theme.dark': 'dark',
  'palette.theme.light': 'light',
  'palette.group.actions': 'Actions',
  'palette.group.tasks': 'Tasks',
  'palette.group.types': 'Types',
  'palette.type.builtin': 'built-in',
  'palette.type.custom': 'custom',
  'palette.type.notifyBuiltin': '“{label}” is a built-in type',
  'palette.type.notifyCustom': 'The type “{label}” already exists',

  // ---- the first-run welcome ----
  'welcome.title': 'Welcome to Beyond the Dialogue',
  'welcome.sub':
    'A to-do board where an AI agent works each kind of task with you and files the results into your personal wiki.',
  'welcome.openSettings': 'Open Settings',
  'welcome.step1.title': '1 · Pick a task type',
  'welcome.step1.body': 'Learning, JIRA/Confluence, plain, or your own types — each type declares its inputs and its AI flow.',
  'welcome.step2.title': "2 · Work with the agent's help",
  'welcome.step2.body':
    'Add a task to My Day and the agent pre-processes it: a working prompt, a summary, and activity suggestions.',
  'welcome.step3.title': '3 · Finish → it files itself into your wiki',
  'welcome.step3.body':
    'Finished learning notes land in your wiki (Obsidian-ready); index and log updated. Point the learning type at a wiki folder in Settings first.',
  'welcome.connect': 'Connect an AI provider to get started',
  'welcome.saveAndStart': 'Save & start',
  'welcome.trySample': 'Try a sample learning task →',
  'welcome.skip': 'Skip — just show me the board (plain tasks work without AI)',
  'welcome.sample.title': 'Linear algebra review',
  'welcome.sample.target': 'Eigenvalues and why they matter',

  // ---- task types ----
  // The suffix a custom type's name carries wherever types are listed.
  'type.customSuffix': '（custom）',

  // The seeded presentation of the four built-in types. `src/main/db.ts` seeds
  // rows FROM these strings, and the renderer decides whether a stored label is
  // still the default by comparing it against them — so their text is the
  // contract, not just the display. Changing one changes what counts as
  // "untouched", and a type already renamed by the user stays theirs in every
  // language either way.
  'type.plain.label': 'Plain task',
  'type.plain.description': 'A plain task — notes and suggestions only, no AI pre-process',
  'type.learning.label': 'Learning',
  'type.learning.description': 'Learn a concept: AI prompt + summary, markdown note, Finish ingests to the wiki',
  'type.learning.field.target.label': 'Target',
  'type.learning.field.target.placeholder': 'The concept or question to learn',
  'type.learning.field.filePath.label': 'File',
  'type.learning.field.filePath.placeholder': 'Optional markdown (.md) attachment',
  'type.learning.field.purpose.label': 'Prompt',
  'type.learning.field.purpose.placeholder':
    'What you want the learning note to cover (injected into the learning prompt)',
  'type.learning.field.learningNotePath.label': 'Learning-note path',
  'type.learning.field.learningNotePath.placeholder': 'Defaults inside the wiki',
  'type.jira.label': 'JIRA / Confluence',
  'type.jira.description': 'Work an issue or page from pasted content: summaries, chat, comment drafts',
  'type.jira.field.sourceKind.label': 'Source kind',
  'type.jira.field.sourceKind.option.issue': 'JIRA issue',
  'type.jira.field.sourceKind.option.page': 'Confluence page',
  'type.jira.field.sourceLink.label': 'Link',
  'type.jira.field.sourceLink.placeholder': 'Ticket/page URL (reference only in v0.8)',
  'type.jira.field.sourceText.label': 'Source content',
  'type.jira.field.sourceText.placeholder': 'Paste the issue/page content',
  'type.jira.field.target.label': 'Target / Purpose',
  'type.jira.field.target.placeholder': 'What you want done with it',
  'type.jira.field.comments.label': 'Comment drafts',
  'type.jira.field.comments.placeholder': 'Draft comments for the issue/page (local only)',
  'type.meeting.label': 'Meeting',
  'type.meeting.description':
    'Prepare for a meeting: AI agenda + core topics, minutes in the working area, polished into a folder you own',
  'type.meeting.field.target.label': 'Objective',
  'type.meeting.field.target.placeholder': 'What the meeting is about and what it should achieve',
  'type.meeting.field.filePath.label': 'File',
  'type.meeting.field.filePath.placeholder': 'Optional markdown (.md) attachment',
  'type.meeting.field.purpose.label': 'Prompt',
  'type.meeting.field.purpose.placeholder': 'What the agenda and core topics should focus on',

  // ---- settings ----
  'settings.sections': 'Settings sections',
  'settings.tab.general': 'General',
  'settings.tab.types': 'Types',
  'settings.tab.plugins': 'Plugins',
  'settings.tab.ai': 'AI',
  'settings.appearance.title': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.appearance.language': 'Language',
  'settings.appearance.language.hint': '(applies immediately, saved on Save)',
  'settings.ai.title': 'AI provider',
  'settings.ai.provider': 'Provider',
  'settings.ai.model': 'Model',
  'settings.ai.apiKey': 'API key',
  'settings.ai.apiKey.hint': "(stored in the app's private data dir)",
  'settings.ai.test': 'Test connection',
  'settings.ai.testing': 'Testing…',
  'settings.ai.connected': 'Connected — model replied: {text}',
  'settings.ai.failed': 'Failed: {error}',
  'settings.ai.configured': 'AI is configured · {provider} / {model}',
  'settings.ai.noModel': 'no model',
  'settings.ai.notConfigured': 'AI not configured — non-AI features still work. Configure in the AI tab.',
  'settings.types.builtin.title': 'Built-in types',
  'settings.types.builtin.hint': 'Presentation is editable; behavior is fixed',
  'settings.types.custom.title': 'Custom types',
  'settings.types.new': 'New type',
  'settings.types.editPresentation': 'Edit presentation',
  'settings.types.empty.title': 'No custom types yet',
  'settings.types.empty.body':
    'Click “＋ New type” to wrap a built-in behavior kind with your own label, emoji, and input fields.',
  'settings.plugins.inert':
    "Skills are imported into the app's skill folder but not yet loaded by the agent. MCP servers you add here are connected to interactive sessions of types that grant them, and written to the app's mcp.json.",
  'settings.plugins.saveFailed': 'Could not save: {error}',
  'settings.plugins.removeSkill.title': 'Remove skill',
  'settings.plugins.removeSkill.message': 'Remove skill “{name}”?',
  'settings.plugins.removeServer.title': 'Remove MCP server',
  'settings.plugins.removeServer.message': 'Remove MCP server “{name}”?',
  'settings.skills.title': 'Skills',
  'settings.skills.hint': 'imported · not yet loaded by the agent',
  'settings.skills.nameKey': 'Name is the key',
  'settings.skills.noDescription': 'no description',
  'settings.skills.empty': 'No skills yet',
  'settings.skills.emptyBody': 'Import a folder containing SKILL.md to add a skill.',
  'settings.skills.import': 'Import skill folder',
  'settings.skills.importing': 'Importing…',
  'settings.skills.importFailed': 'Could not import the skill folder',
  'settings.skills.exists': 'Skill “{name}” already exists — names must be unique',
  'settings.skills.githubImport': 'Import from GitHub',
  'settings.skills.githubPlaceholder': 'https://github.com/owner/repo — optionally /tree/ref/subdir',
  'settings.skills.githubImportFailed': 'Could not import from GitHub',
  'settings.mcp.title': 'MCP servers',
  'settings.mcp.hint': 'paste a standard mcp.json server config',
  'settings.mcp.empty': 'No MCP servers yet',
  'settings.mcp.pastePlaceholder': '{"mcpServers": { "name": { "command": "npx", "args": ["-y", "some-mcp-server"] } }}',
  'settings.mcp.addJson': 'Add servers',
  'settings.mcp.emptyPaste': 'Paste a server configuration first',
  'settings.mcp.exists': 'MCP server "{name}" already exists — names must be unique',
  'settings.mcp.mcpJsonNote': "These servers are also written to the app's mcp.json automatically (an inspection copy — the agent reads its own settings).",
  'settings.mcp.trustNote': 'A server you add runs with your own permissions — the app never invokes its command, env helpers, or credentials on its own.',
  'settings.mcp.materializeFailed': 'MCP servers were saved, but writing mcp.json failed: {error}',

  // ---- what each finish behaviour does (FR-014) ----
  'finishBehaviour.completeOnly': 'Complete only — writes nothing',
  'finishBehaviour.fileAsIs': 'File as-is — saves your content unchanged',
  'finishBehaviour.polishThenFile': 'Polish then file — the assistant rewrites it, then saves',
  'finishBehaviour.depositThenCurate':
    'Deposit then curate — raw material preserved first, then the assistant authors the artifact',

  // ---- the workflow-type editor ----
  'typeEditor.newTag': 'NEW',
  'typeEditor.editTag': 'EDIT',
  'typeEditor.newTitle': 'New type',
  'typeEditor.editBuiltin': 'Edit built-in presentation',
  'typeEditor.editTitle': 'Edit type',
  'typeEditor.key': 'Key',
  'typeEditor.keyPlaceholder': 'e.g. code_review',
  'typeEditor.emoji': 'Emoji',
  'typeEditor.label': 'Label',
  'typeEditor.labelPlaceholder': 'e.g. Code review',
  'typeEditor.description': 'Description',
  'typeEditor.descriptionPlaceholder': 'What this type is for',
  'typeEditor.kind': 'Behavior kind',
  'typeEditor.kind.plain': 'plain — notes & suggestion chips only',
  'typeEditor.kind.learning': 'learning — prompt/summary, note editor, curated on Finish',
  'typeEditor.kind.jira': 'jira — pasted source, chat, comment drafts',
  'typeEditor.kind.meeting': 'meeting — agenda/core topics, minutes editor',
  'typeEditor.fields': 'Input fields (from this kind)',
  'typeEditor.aiGuidance': 'AI guidance',
  'typeEditor.aiGuidanceHint': "(optional — appended to this type's pre-process prompt)",
  'typeEditor.aiGuidancePlaceholder': 'e.g. Focus on security review angles.',
  'typeEditor.finishBehaviour': 'Finish behaviour',
  'typeEditor.finishFixed': 'fixed for a built-in type',
  'typeEditor.finishHint': 'What happens to your work when you press Finish on a task of this type.',
  'typeEditor.destination': 'Output destination',
  'typeEditor.dest.folder': 'A folder I own',
  'typeEditor.dest.wiki': 'The wiki',
  'typeEditor.subfolder': 'Subfolder',
  'typeEditor.subfolderHint': '(optional, relative)',
  'typeEditor.folderHint':
    'Plain markdown files land here. Nothing else is written, and an existing file is never overwritten.',
  'typeEditor.wikiResolved': 'Resolved as {dest} — the wiki structure is created there on first use; your existing files are never overwritten.',
  'typeEditor.capabilities': 'Assistant capabilities',
  'typeEditor.capabilitiesHint':
    'Skills and tool servers let the assistant do more on a task of this type. Granting external reach means the assistant can act on that system — and that sessions for this type will no longer see your notes and minutes.',
  'typeEditor.skillsLabel': 'Skills — capabilities the assistant can load:',
  'typeEditor.serversLabel': 'Tool servers — external systems the assistant can read from and act on:',
  'typeEditor.noneImported': 'none imported yet',
  'typeEditor.noneRegistered': 'none registered yet',
  'typeEditor.grantReach': '— grants external reach',
  'typeEditor.grantHint': 'A change here takes effect on the next session; existing tasks do not need recreating.',
  'typeEditor.keyRequired': 'Key is required',
  'typeEditor.keyFormat': 'Key must be lowercase letters, digits, underscore (2–32 chars)',
  'typeEditor.keyTaken': 'Key "{key}" is already used',
  'typeEditor.labelRequired': 'Label is required',
  'typeEditor.emojiRequired': 'Emoji is required',
  'typeEditor.needsFolder': 'This behaviour writes a file, so it needs a destination folder',
  'typeEditor.subfolderRelative': 'The subfolder must be relative and must not contain ".."',
  'typeEditor.deleteTag': 'DELETE',
  'typeEditor.deleteTitle': 'Delete type “{label}”?',
  'typeEditor.deleteInUse':
    '{count} task(s) use this type. They will fall back to plain; their titles, notes, lists, and completion state are kept.',
  'typeEditor.deleteUnused': 'No tasks currently use this type.',
  'typeEditor.deleteHint': 'The type itself is removed from pickers and this Settings list.',
  'typeEditor.deleteConfirm': 'Delete type'
} satisfies Record<string, string>

export type MessageKey = keyof typeof en

/**
 * Every language's catalog must carry exactly these keys. Annotating the other
 * catalogs with this type is what enforces coverage.
 */
export type Catalog = Record<MessageKey, string>
