import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { openDB, migrate, loadSettings, saveSettings, type DB } from './db'
import { ensureVault, writeNote, storePdf } from './vault'
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
import { runAnalysisJob } from './jobs/analysis'
import { runSuggestionJob } from './jobs/suggestions'
import { runIngestJob } from './jobs/ingest'
import { configureRuntimeFromSettings, isConfigured } from './agent-runtime'
import { getAnalysis, getNotes, listIngest, listSuggestions, listAllSuggestions, getTask, saveNotes, dismissSuggestion, getJob, updateTask } from './db'
import { notePathFor } from './vault'
import { IPC } from '../shared/ipc'
import type { AppSnapshot, Settings } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: DB | null = null
let queue: JobQueue | null = null

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
    if (job.taskId) {
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, t)
    }
  })
  q.on('ingest-done', (rec) => {
    broadcast('ev:ingest-updated', rec)
  })
  q.on('ingest-failed', (rec) => {
    broadcast('ev:ingest-updated', rec)
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
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  ipcMain.handle(IPC.updateTask, (_e, args) => {
    const task = serviceUpdateTask(d(), args.id, {
      title: args.title,
      notes: args.notes,
      link: args.link
    })
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
    // Analysis triggers on add to My Day (spec 5.6). Never re-analyze a task
    // already analyzed (ready/abstract_only); a failed analysis may retry.
    if (args.inMyDay && task.type === 'paper_reading' && !task.link) {
      // nothing to analyze
    } else if (
      args.inMyDay &&
      task.type === 'paper_reading' &&
      task.analysisStatus !== 'ready' &&
      task.analysisStatus !== 'abstract_only'
    ) {
      queue!.enqueue('analysis', task.id)
    }
    // Suggestions fire when the task is newly added (not on repeat adds).
    if (args.inMyDay && before && !before.inMyDay) {
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
    broadcast('ev:toast', { message: 'Task finished — wiki ingestion started in the background' })
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
    const s = args.settings
    saveSettings(d(), s)
    await configureRuntimeFromSettings(s)
    broadcast('ev:settings-updated', s)
    return loadSettings(d())
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
      preload: path.join(__dirname, '../preload/index.js'),
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
