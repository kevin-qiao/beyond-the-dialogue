import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { openDB, migrate, loadSettings, saveSettings, type DB } from './db'
import { ensureVault, writeNote, storePdf } from './wiki/vault'
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
import { runAnalysisJob } from './paper/analysis'
import { runSuggestionJob } from './suggestions'
import { runIngestJob } from './wiki/ingest'
import { configureRuntimeFromSettings, isConfigured, listModelsForProvider, listProviders, testPrompt } from './ai/agent-runtime'
import { ChatSession } from './ai/chat'
import { shouldAutoAnalyze, shouldSuggestOnMyDayAdd } from './ai/triggers'
import { getAnalysis, getNotes, listIngest, listSuggestions, listAllSuggestions, getTask, saveNotes, dismissSuggestion, getJob, updateTask } from './db'
import { notePathFor } from './wiki/vault'
import { IPC } from '../shared/ipc'
import type { AppSnapshot, Settings, Task } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: DB | null = null
let queue: JobQueue | null = null
// Debug chat: one in-memory conversation against the configured model.
const chatSession = new ChatSession()

function buildSnapshot(): AppSnapshot {
  const d = db!.db
  const lists = serviceLists(d)
  const tasks = serviceListForList(d)
  const suggestions = listAllSuggestions(d)
  const analyses: Record<string, NonNullable<ReturnType<typeof getAnalysis>>> = {}
  const notes: Record<string, NonNullable<ReturnType<typeof getNotes>>> = {}
  for (const t of tasks) {
    const a = getAnalysis(d, t.id)
    if (a) analyses[t.id] = a
    const n = getNotes(d, t.id)
    if (n) notes[t.id] = n
  }
  const settings = loadSettings(d)
  return {
    lists,
    tasks,
    suggestions,
    analyses,
    notes,
    settings,
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
    if (job.kind === 'analysis' && job.taskId) {
      const a = getAnalysis(d(), job.taskId)
      if (a) broadcast(IPC.evAnalysisUpdated, a)
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, t)
    }
    if (job.kind === 'suggestion' && job.taskId) {
      broadcast(IPC.evSuggestionsUpdated, listSuggestions(d(), job.taskId))
    }
  })
  q.on('failed', (job) => {
    if (job.kind === 'analysis' && job.taskId) {
      // Unstick the task: a failed job must leave analysisStatus 'failed'
      // (with the reason) so the row/detail show Retry instead of a forever
      // "analyzing…" state.
      updateTask(d(), job.taskId, { analysisStatus: 'failed', analysisError: job.error ?? 'analysis failed' })
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
    const task = serviceCreateTask(d(), args)
    // Analysis auto-starts for paper tasks created with a link (spec
    // analysis-lifecycle); never enqueued when AI is not configured.
    if (shouldAutoAnalyze(task, loadSettings(d()))) {
      queue!.enqueue('analysis', task.id)
    }
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.updateTask, (_e, args) => {
    const before = getTask(d(), args.id)
    if (!before) throw new Error('task not found')
    const patch: Partial<Task> = { title: args.title, notes: args.notes, type: args.type }
    if (args.customTypeKey !== undefined) {
      patch.customTypeKey = args.customTypeKey ?? null
    }
    const newLink = args.link !== undefined ? args.link.trim() || null : undefined
    const linkChanged = newLink !== undefined && newLink !== before.link
    if (linkChanged) {
      // A link edit (or clearing it) invalidates everything derived from the
      // old link: resolved title, level, mismatch state, and any analysis
      // result — so the panel never shows metadata from a previous paper.
      patch.link = newLink
      patch.paperTitle = null
      patch.analysisLevel = null
      patch.analysisStatus = 'none'
      patch.mismatchState = 'none'
      patch.analysisError = null
    }
    let task = serviceUpdateTask(d(), args.id, patch)
    if (args.type && args.type !== before.type) {
      if (args.type === 'plain') {
        // Downgrade to plain: clear the paper enrichment fields.
        task = serviceUpdateTask(d(), args.id, {
          link: null,
          paperTitle: null,
          analysisLevel: null,
          analysisStatus: 'none',
          mismatchState: 'none',
          analysisError: null,
          pdfPath: null
        })
      } else if (args.type === 'paper_reading' && task.link && isConfigured(loadSettings(d()))) {
        task = serviceUpdateTask(d(), args.id, { analysisStatus: 'queued', analysisError: null })
        queue!.enqueue('analysis', task.id)
      }
    } else if (
      task.type === 'paper_reading' &&
      task.link &&
      task.analysisStatus !== 'ready' &&
      task.analysisStatus !== 'abstract_only' &&
      isConfigured(loadSettings(d()))
    ) {
      // A link set (or fixed) on a paper task starts analysis: 'none' mirrors
      // creation, 'failed' is a retry after the user corrected the link.
      // ready/abstract_only tasks never re-run. Mark queued immediately so
      // the UI stops showing the stale failure.
      task = serviceUpdateTask(d(), args.id, { analysisStatus: 'queued', analysisError: null })
      queue!.enqueue('analysis', task.id)
    }
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.deleteTask, (_e, args) => {
    serviceDeleteTask(d(), args.id)
    broadcast(IPC.evTaskUpdated, { id: args.id, deleted: true })
    return undefined
  })
  ipcMain.handle(IPC.toggleTask, (_e, args) => {
    const task = serviceToggleTask(d(), args.id)
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.setMyDay, (_e, args) => {
    const before = getTask(d(), args.id)
    const task = serviceSetMyDay(d(), args.id, args.inMyDay)
    broadcast(IPC.evTaskUpdated, task)
    // My Day is planning-only (spec analysis-lifecycle): it never triggers
    // analysis. Suggestion chips are a My Day feature and fire on first add.
    if (shouldSuggestOnMyDayAdd(before, args.inMyDay)) {
      queue!.enqueue('suggestion', task.id)
    }
    return task
  })
  ipcMain.handle(IPC.setTaskDone, (_e, args) => {
    const task = serviceUpdateTask(d(), args.id, {
      completed: args.done,
      completedAt: args.done ? new Date().toISOString() : null
    })
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
  ipcMain.handle(IPC.attachPdf, (_e, args) => {
    const dest = storePdf(args.taskId, args.pdfPath)
    const task = updateTask(d(), args.taskId, { pdfPath: dest, mismatchState: 'confirmed' })
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.requestReanalysis, (_e, args) => {
    const t = getTask(d(), args.id)
    if (!t) throw new Error('task not found')
    updateTask(d(), args.id, { analysisStatus: 'queued', mismatchState: 'none', analysisError: null })
    queue!.enqueue('analysis', args.id)
    const task = getTask(d(), args.id)
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.resolveMismatch, (_e, args) => {
    const task = updateTask(d(), args.id, { mismatchState: args.action === 'confirm' ? 'confirmed' : 'confirmed' })
    if (args.action === 'correct') {
      // Link already corrected via updateTask; re-run analysis.
      updateTask(d(), args.id, { analysisStatus: 'queued', analysisError: null })
      queue!.enqueue('analysis', args.id)
    }
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.finishTask, (_e, args) => {
    const t = getTask(d(), args.id)
    if (!t) throw new Error('task not found')
    // Mark completed and hand off to ingestion immediately.
    const now = new Date().toISOString()
    const task = updateTask(d(), args.id, { completed: true, completedAt: now })
    // Enqueue ingestion job (deposit-first happens inside the job).
    queue!.enqueueIngest(args.id, task.title, [])
    broadcast(IPC.evTaskUpdated, task)
    broadcast(IPC.evToast, { message: 'Task finished — wiki ingestion started', view: 'activity' })
    return task
  })
  ipcMain.handle(IPC.choosePdf, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle(IPC.cancelJob, (_e, args) => {
    queue!.cancel(args.jobId)
    return undefined
  })
  ipcMain.handle(IPC.retryJob, (_e, args) => {
    const job = getJob(d(), args.jobId)
    if (!job) throw new Error('job not found')
    if (job.kind === 'analysis' && job.taskId) {
      updateTask(d(), job.taskId, { analysisStatus: 'queued', analysisError: null })
      queue!.retryJob(args.jobId)
    } else {
      queue!.retryJob(args.jobId)
    }
    return undefined
  })
  ipcMain.handle(IPC.getSettings, () => loadSettings(d()))
  ipcMain.handle(IPC.saveSettings, async (_e, args: { settings: Settings }) => {
    // Configuring an API key counts as completing first-run setup.
    const s = args.settings.apiKey ? { ...args.settings, showWelcome: false } : args.settings
    saveSettings(d(), s)
    await configureRuntimeFromSettings(s)
    broadcast('ev:settings-updated', s)
    return loadSettings(d())
  })
  ipcMain.handle(IPC.listModels, (_e, provider: string) => listModelsForProvider(provider))
  ipcMain.handle(IPC.listProviders, () => listProviders())
  ipcMain.handle(IPC.testConnection, async (_e, settings: Settings) => testPrompt(settings, 'Reply with exactly: OK'))
  ipcMain.handle(IPC.sendChat, async (_e, text: string) => {
    const settings = loadSettings(d())
    try {
      const reply = await chatSession.send(text, settings, (delta) => broadcast(IPC.evChatDelta, { delta }))
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
    title: 'Work Board',
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
  queue.register('analysis', runAnalysisJob)
  queue.register('suggestion', runSuggestionJob)
  queue.register('ingest', runIngestJob)
  wireJobEvents(queue)
  queue.requeueInterrupted()

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
  if (db) {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
})

export { db }
