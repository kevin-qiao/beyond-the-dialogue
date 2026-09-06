import { app, BrowserWindow, dialog, ipcMain, Menu, Notification } from 'electron'
import { AlarmScheduler } from './alarms'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { openDB, migrate, loadSettings, saveSettings, type DB } from './db'
import { ensureVault, writeNote } from './wiki/vault'
import {
  serviceCreateList,
  serviceCreateTask,
  serviceDeleteList,
  serviceDeleteTask,
  serviceListForList,
  serviceLists,
  serviceRenameList,
  serviceSetMyDay,
  serviceToggleTask,
  serviceUpdateTask,
  rolloverMyDay
} from './tasks'
import { JobQueue } from './job-queue'
import { runSuggestionJob } from './suggestions'
import { runPreprocessJob } from './preprocess'
import { runIngestJob } from './wiki/ingest'
import { configureRuntimeFromSettings, isConfigured, listModelsForProvider, listProviders, testPrompt } from './ai/agent-runtime'
import { ChatSession } from './ai/chat'
import { shouldSuggestOnMyDayAdd, shouldPreprocessOnAdd, shouldPreprocessOnEdit } from './ai/triggers'
import { getPreprocess, getNotes, listIngest, listSuggestions, listAllSuggestions, getTask, saveNotes, dismissSuggestion, getJob, updateTask } from './db'
import { notePathFor } from './wiki/vault'
import { resolveWikiPath, resolveLearningNotePath } from './wiki/wiki'
import { createTypeDef, deleteTypeDef, effectiveKind, effectiveTypeDef, getTypeDef, hasUnfilledRequiredInputs, listTypeDefs, preprocessInputHash, updateTypeDef, validateInputsForWrite } from './types'
import { validatePluginEntries } from './plugins'
import { importSkillFolder } from './skills'
import { IPC } from '../shared/ipc'
import type { AppSnapshot, Settings, Task, TaskTypeDef } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: DB | null = null
let queue: JobQueue | null = null
// Debug chat + task-grounded working-area chat: one in-memory conversation at
// a time (design D4), keyed by the task whose panel owns it.
const chatSession = new ChatSession()
let chatTaskId: string | null = null
let alarms: AlarmScheduler | null = null

function rescheduleAlarms(): void {
  alarms?.reschedule()
}

// OS notification for a fired alarm (spec task-notifications): firing works
// whether the app is focused or not; clicking focuses the window and opens
// the task in the renderer.
function raiseAlarmNotification(fire: { taskId: string; title: string }): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Beyond the Dialogue', body: fire.title })
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    broadcast(IPC.evOpenTask, fire.taskId)
  })
  n.show()
}

// Per-kind chat grounding (spec learning-type / jira-confluence-type):
// learning = working prompt + inputs + current note; jira = pasted source +
// pre-process summaries. Built fresh on each send; never persisted.
function buildChatContext(d: DatabaseSync, taskId: string): string | undefined {
  const task = getTask(d, taskId)
  if (!task) return undefined
  const def = effectiveTypeDef(d, task)
  const kind = def?.kind ?? 'plain'
  if (kind === 'plain') return undefined
  const pp = getPreprocess(d, taskId)
  const note = getNotes(d, taskId)
  const lines = [
    `Task: ${task.title}`,
    task.notes ? `Description: ${task.notes}` : '',
    kind === 'learning' && pp?.generatedPrompt ? `Working prompt: ${pp.generatedPrompt}` : '',
    pp?.summary ? `Pre-process summary: ${pp.summary}` : '',
    kind === 'learning' && typeof task.inputs.target === 'string' ? `Target: ${task.inputs.target}` : '',
    kind === 'learning' && typeof task.inputs.purpose === 'string' ? `Prompt: ${task.inputs.purpose}` : '',
    kind === 'jira' ? `Source kind: ${task.inputs.sourceKind === 'page' ? 'Confluence page' : 'JIRA issue'}` : '',
    kind === 'jira' && typeof task.inputs.sourceText === 'string' ? `Pasted source content:\n${task.inputs.sourceText.slice(0, 60_000)}` : '',
    kind === 'learning' && note?.content ? `Current learning note:\n${note.content.slice(0, 60_000)}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

function buildSnapshot(): AppSnapshot {
  const d = db!.db
  const lists = serviceLists(d)
  const tasks = serviceListForList(d)
  const suggestions = listAllSuggestions(d)
  const preprocess: AppSnapshot['preprocess'] = {}
  const notes: AppSnapshot['notes'] = {}
  for (const t of tasks) {
    const p = getPreprocess(d, t.id)
    if (p) preprocess[t.id] = p
    const n = getNotes(d, t.id)
    if (n) notes[t.id] = n
  }
  const settings = loadSettings(d)
  return {
    lists,
    tasks,
    suggestions,
    preprocess,
    notes,
    settings,
    taskTypes: listTypeDefs(d),
    aiConfigured: isConfigured(settings),
    ingestHistory: listIngest(d)
  }
}

function broadcast(event: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, payload)
  }
}

function wireJobEvents(q: JobQueue): void {
  const d = () => db!.db
  q.on('progress', (job) => {
    broadcast(IPC.evJobProgress, {
      jobId: job.id,
      kind: job.kind,
      taskId: job.taskId,
      state: job.state,
      stepLabel: job.stepLabel,
      error: job.error
    })
    if (job.taskId) {
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, t)
    }
  })
  q.on('done', (job) => {
    if (job.kind === 'preprocess' && job.taskId) {
      const p = getPreprocess(d(), job.taskId)
      if (p) broadcast(IPC.evPreprocessUpdated, p)
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, t)
    }
    if (job.kind === 'suggestion' && job.taskId) {
      broadcast(IPC.evSuggestionsUpdated, listSuggestions(d(), job.taskId))
    }
  })
  q.on('failed', (job) => {
    if (job.kind === 'preprocess' && job.taskId) {
      // Unstick the task: a failed job must leave preprocessStatus 'failed'
      // (with the reason) so the band shows Retry instead of a forever
      // "working…" state.
      updateTask(d(), job.taskId, { preprocessStatus: 'failed', preprocessError: job.error ?? 'pre-process failed' })
    }
    if (job.taskId) {
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, t)
    }
  })
  q.on('ingest-done', (rec) => {
    broadcast(IPC.evIngestUpdated, rec)
    broadcast(IPC.evToast, { message: `Ingested '${rec.taskTitle}' into wiki`, view: 'activity' })
  })
  q.on('ingest-failed', (rec) => {
    broadcast(IPC.evIngestUpdated, rec)
  })
  q.on('ingest-progress', (ev) => {
    broadcast(IPC.evIngestProgress, ev)
  })
}

// Resolve the effective type def for a task about to be created/edited.
function defFor(db: DatabaseSync, type: Task['type'] | undefined, customTypeKey: string | null | undefined): TaskTypeDef | null {
  return effectiveTypeDef(db, { type: type ?? 'plain', customTypeKey: customTypeKey ?? null })
}

function registerIpc(): void {
  const d = () => db!.db
  ipcMain.handle(IPC.getSnapshot, () => buildSnapshot())

  ipcMain.handle(IPC.createList, (_e, args) => {
    const list = serviceCreateList(d(), args.name)
    broadcast(IPC.evListUpdated, list)
    return list
  })
  ipcMain.handle(IPC.renameList, (_e, args) => {
    const list = serviceRenameList(d(), args.id, args.name)
    broadcast(IPC.evListUpdated, list)
    return list
  })
  ipcMain.handle(IPC.deleteList, (_e, args) => {
    serviceDeleteList(d(), args.id)
    broadcast(IPC.evListUpdated, null)
    return undefined
  })
  ipcMain.handle(IPC.createTask, (_e, args) => {
    const def = defFor(d(), args.type, args.customTypeKey ?? null)
    const inputs = args.inputs ?? {}
    if (def) {
      const v = validateInputsForWrite(def, inputs, {})
      if (!v.ok) throw new Error(v.errors.join('; '))
    }
    const task = serviceCreateTask(d(), {
      listId: args.listId,
      title: args.title,
      notes: args.notes,
      type: args.type,
      customTypeKey: args.customTypeKey ?? null,
      inputs
    })
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.updateTask, (_e, args) => {
    const before = getTask(d(), args.id)
    if (!before) throw new Error('task not found')
    const patch: Partial<Task> = { title: args.title, notes: args.notes }
    const typeChanged = (args.type !== undefined && args.type !== before.type) || (args.customTypeKey !== undefined && (args.customTypeKey ?? null) !== before.customTypeKey)
    if (args.type !== undefined) patch.type = args.type
    if (args.customTypeKey !== undefined) patch.customTypeKey = args.customTypeKey ?? null
    if (typeChanged) {
      // Switching type discards inputs not present in the new type (spec).
      // We clear all inputs; the renderer re-collects what carries over.
      patch.inputs = {}
    } else if (args.inputs !== undefined) {
      const def = defFor(d(), before.type, before.customTypeKey)
      if (def) {
        const v = validateInputsForWrite(def, args.inputs, before.inputs)
        if (!v.ok) throw new Error(v.errors.join('; '))
      }
      patch.inputs = args.inputs
    }
    let task = serviceUpdateTask(d(), args.id, patch)
    // Hash-gated pre-process re-run: relevant inputs changed while the task
    // sits in My Day (design D3). Skipped when the type itself changed (the
    // stale outputs belong to the old kind; My Day re-add re-runs fresh).
    if (!typeChanged && (args.inputs !== undefined || args.title !== undefined || args.notes !== undefined)) {
      const kind = effectiveKind(d(), task)
      const def = defFor(d(), task.type, task.customTypeKey)
      const newHash = preprocessInputHash(task, def)
      const consumed = getPreprocess(d(), task.id)?.inputsHash ?? ''
      if (shouldPreprocessOnEdit(task, kind, loadSettings(d()), newHash, consumed)) {
        task = updateTask(d(), task.id, { preprocessStatus: 'queued', preprocessError: null })
        queue!.enqueue('preprocess', task.id)
      }
    }
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.runPreprocess, (_e, args) => {
    const t = getTask(d(), args.id)
    if (!t) throw new Error('task not found')
    const kind = effectiveKind(d(), t)
    if (kind === 'plain') throw new Error('this task type has no pre-process')
    if (!isConfigured(loadSettings(d()))) throw new Error('AI not configured: open Settings to configure a provider, model and API key')
    const task = updateTask(d(), args.id, { preprocessStatus: 'queued', preprocessError: null })
    queue!.enqueue('preprocess', task.id)
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.deleteTask, (_e, args) => {
    serviceDeleteTask(d(), args.id)
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, { id: args.id, deleted: true })
    return undefined
  })
  ipcMain.handle(IPC.toggleTask, (_e, args) => {
    const task = serviceToggleTask(d(), args.id)
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.setMyDay, (_e, args) => {
    const before = getTask(d(), args.id)
    let task = serviceSetMyDay(d(), args.id, args.inMyDay)
    // My Day is planning-only: first add fires the suggestion chips for
    // plain tasks, or the kind's pre-process for AI-kinded types (whose
    // activity suggestions land as chips from the pre-process output —
    // design D3 folds them in, so the two jobs never both run).
    const kind = effectiveKind(d(), task)
    if (shouldSuggestOnMyDayAdd(before, args.inMyDay) && kind === 'plain') {
      queue!.enqueue('suggestion', task.id)
    }
    if (shouldPreprocessOnAdd(before, args.inMyDay, kind, loadSettings(d()))) {
      task = updateTask(d(), task.id, { preprocessStatus: 'queued', preprocessError: null })
      queue!.enqueue('preprocess', task.id)
    }
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.setTaskDone, (_e, args) => {
    const task = serviceUpdateTask(d(), args.id, {
      completed: args.done,
      completedAt: args.done ? new Date().toISOString() : null,
      // Completing a task cancels its alarm (spec task-notifications).
      ...(args.done ? { alarmAt: null } : {})
    })
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.setAlarm, (_e, args) => {
    const task = updateTask(d(), args.id, { alarmAt: args.alarmAt ?? null })
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.saveNote, (_e, args) => {
    ensureVault()
    writeNote(args.taskId, args.content)
    const notes = saveNotes(d(), { taskId: args.taskId, notePath: notePathFor(args.taskId), content: args.content })
    broadcast(IPC.evTaskUpdated, getTask(d(), args.taskId))
    return notes
  })
  ipcMain.handle(IPC.finishTask, (_e, args) => {
    const t = getTask(d(), args.id)
    if (!t) throw new Error('task not found')
    // Finish gating: required inputs of the effective type must be filled
    // (spec task-types: required input gates finish).
    const def = defFor(d(), t.type, t.customTypeKey)
    if (def) {
      const missing = hasUnfilledRequiredInputs(def, t.inputs)
      if (missing.length > 0) {
        throw new Error(`cannot finish: missing required input(s): ${missing.map((f) => f.label).join(', ')}`)
      }
    }
    // A learning-note path that no longer resolves under the current wiki
    // (wiki moved?) is surfaced, never silently mis-saved (spec learning-type).
    if (typeof t.inputs.learningNotePath === 'string' && t.inputs.learningNotePath.trim()) {
      const wikiPath = resolveWikiPath(loadSettings(d()).wikiPath)
      const resolved = resolveLearningNotePath(wikiPath, t.inputs.learningNotePath, t.title, t.id)
      if (!resolved.insideWiki) {
        throw new Error(`learning-note path "${t.inputs.learningNotePath}" is outside the current wiki — re-point it in the task inputs`)
      }
    }
    // Mark completed and hand off to ingestion immediately.
    const now = new Date().toISOString()
    const task = updateTask(d(), args.id, { completed: true, completedAt: now, alarmAt: null })
    // Finish behavior is kind-specific (spec learning-type / jira-confluence-type):
    // learning deposits the note and auto-ingests; jira kinds finish locally
    // only (no remote write, no wiki ingestion in v0.8).
    if (effectiveKind(d(), task) === 'learning') {
      queue!.enqueueIngest(args.id, task.title, [])
      broadcast(IPC.evToast, { message: 'Task finished — wiki ingestion started', view: 'activity' })
    }
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.chooseFile, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle(IPC.importSkill, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return importSkillFolder(res.filePaths[0])
  })
  ipcMain.handle(IPC.listTypes, () => listTypeDefs(d()))
  ipcMain.handle(IPC.saveType, (_e, args) => {
    const existing = args.type?.key ? getTypeDef(d(), args.type.key) : null
    const saved = existing ? updateTypeDef(d(), args.type) : createTypeDef(d(), args.type)
    broadcast(IPC.evTypesUpdated, listTypeDefs(d()))
    return saved
  })
  ipcMain.handle(IPC.deleteType, (_e, args) => {
    deleteTypeDef(d(), args.key)
    broadcast(IPC.evTypesUpdated, listTypeDefs(d()))
    return undefined
  })
  ipcMain.handle(IPC.cancelJob, (_e, args) => {
    queue!.cancel(args.jobId)
    return undefined
  })
  ipcMain.handle(IPC.retryJob, (_e, args) => {
    const job = getJob(d(), args.jobId)
    if (!job) throw new Error('job not found')
    if (job.kind === 'preprocess' && job.taskId) {
      updateTask(d(), job.taskId, { preprocessStatus: 'queued', preprocessError: null })
      queue!.retryJob(args.jobId)
    } else {
      queue!.retryJob(args.jobId)
    }
    return undefined
  })
  ipcMain.handle(IPC.getSettings, () => loadSettings(d()))
  ipcMain.handle(IPC.saveSettings, async (_e, args: { settings: Settings }) => {
    // Managed plugin entries are validated before persistence (spec
    // skills-mcp-settings: duplicate names and malformed transports refuse).
    const pluginErrors = validatePluginEntries(args.settings)
    if (pluginErrors.length > 0) throw new Error(pluginErrors.join('; '))
    // Configuring an API key counts as completing first-run setup.
    const s = args.settings.apiKey ? { ...args.settings, showWelcome: false } : args.settings
    saveSettings(d(), s)
    await configureRuntimeFromSettings(s)
    broadcast(IPC.evSettingsUpdated, s)
    return loadSettings(d())
  })
  ipcMain.handle(IPC.listModels, (_e, provider: string) => listModelsForProvider(provider))
  ipcMain.handle(IPC.listProviders, () => listProviders())
  ipcMain.handle(IPC.testConnection, async (_e, settings: Settings) => testPrompt(settings, 'Reply with exactly: OK'))
  ipcMain.handle(IPC.sendChat, async (_e, args: { text: string; taskId?: string }) => {
    const settings = loadSettings(d())
    // Chat conversations are per-surface: switching task (or returning to the
    // debug chat) starts a fresh conversation with fresh grounding.
    if ((chatTaskId ?? null) !== (args.taskId ?? null)) {
      chatSession.reset()
      chatTaskId = args.taskId ?? null
    }
    const context = args.taskId ? buildChatContext(d(), args.taskId) : undefined
    try {
      const reply = await chatSession.send(args.text, settings, (delta) => broadcast(IPC.evChatDelta, { delta }), context)
      broadcast(IPC.evChatDone, { text: reply })
    } catch (e: any) {
      broadcast(IPC.evChatError, { error: e?.message ?? String(e) })
    }
  })
  ipcMain.handle(IPC.resetChat, () => {
    chatSession.reset()
  })
  ipcMain.handle(IPC.dismissSuggestion, (_e, args) => {
    const s = dismissSuggestion(d(), args.suggestionId)
    broadcast(IPC.evSuggestionsUpdated, listSuggestions(d(), s.taskId))
    return s
  })
  ipcMain.handle(IPC.getActivity, () => listIngest(d()))
  ipcMain.handle(IPC.retryIngest, (_e, args) => {
    queue!.retryIngest(args.ingestId)
    return undefined
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Beyond the Dialogue',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // The UI is fully custom — no default menu bar (File/Edit/View/Window).
  Menu.setApplicationMenu(null)

  const d = openDB(app.getPath('userData'))
  db = d
  migrate(d.db)
  ensureVault()

  // Day rollover on first open after a date change.
  rolloverMyDay(d.db)

  queue = new JobQueue(d.db, loadSettings(d.db).maxConcurrentJobs)
  queue.register('preprocess', runPreprocessJob)
  queue.register('suggestion', runSuggestionJob)
  queue.register('ingest', runIngestJob)
  wireJobEvents(queue)
  queue.requeueInterrupted()

  // Alarms: raise missed ones once, arm the next future one (design D7).
  alarms = new AlarmScheduler(d.db, raiseAlarmNotification)
  alarms.start()

  // Ensure configured key is applied to runtime at startup.
  const settings = loadSettings(d.db)
  await configureRuntimeFromSettings(settings)

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  alarms?.stop()
  if (db) {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
})

export { db }
