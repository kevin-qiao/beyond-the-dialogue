import { app, BrowserWindow, dialog, ipcMain, Menu, Notification } from 'electron'
import { AlarmScheduler } from './alarms'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { openDB, migrate, loadSettings, saveSettings, type DB } from './db'
import { materializeMcpConfig } from './mcpConfigFile'
import { ensureVault, writeNote } from './wiki/vault'
import {
  serviceCreateList,
  serviceDeleteList,
  serviceDeleteTask,
  serviceListForList,
  serviceLists,
  serviceRenameList,
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
import { getPreprocess, getNotes, listIngest, listSuggestions, listAllSuggestions, getTask, saveNotes, dismissSuggestion, getJob, updateTask } from './db'
import { notePathFor } from './wiki/vault'
import { createTypeDef, deleteTypeDef, effectiveKind, effectiveTypeDef, getTypeDef, listTypeDefs, updateTypeDef } from './types'
import { importSkillFolder } from './skills'
import { importSkillFromGitHub } from './skills-github'
import { IPC, type AppCommands, type AppEvents } from '../shared/ipc'
import type { AppSnapshot, Settings, Task, TaskTypeDef } from '../shared/types'
import type { RemoteProposalView } from '../shared/ipc'
import { finishTask as runFinishTask, type FinishDeps } from '../core/services/finishService'
import { declaredWorkflow } from '../core/domain/taskType'
import { saveSettings as saveSettingsService } from '../core/services/settingsService'
import { runPreprocess as runPreprocessService } from '../core/services/preprocessService'
import { buildSessionContext, createProposalQueue } from '../core/domain/grant'
import { buildChatContext } from '../core/domain/chatContext'
import { message } from '../core/i18n'
import { localizeThrown } from './errors'
import {
  createTask as createTaskService,
  setMyDay as setMyDayService,
  updateTask as updateTaskService
} from '../core/services/taskService'
import { createSqliteStorage } from './adapters/sqlite/storageAdapter'
import { createAgentSessionAdapter } from './adapters/agent/sessionAdapter'
import { createNotifier } from './adapters/notifier'
import { artifactStoreFor } from './adapters/artifacts'
import { nodePathPort } from './adapters/paths'
import { systemClock } from '../core/ports/clock'

let mainWindow: BrowserWindow | null = null
let db: DB | null = null
let queue: JobQueue | null = null
// Debug chat + task-grounded working-area chat: one in-memory conversation per
// SURFACE (design D4), not one per app. A single shared session made every
// panel share one transcript — opening another task's chat showed the previous
// task's exchange, and sending from it discarded the other conversation.
const chatSessions = new Map<string, ChatEntry>()
let alarms: AlarmScheduler | null = null

interface ChatEntry {
  session: ChatSession
  // Identifies the grounding this conversation was built from. The session
  // captures its context on the first message, so without comparing this a
  // pre-process that landed mid-conversation would never reach the model.
  grounding: string
}

// The surface key: a task id, or the debug chat's empty string. The wire
// carries `null` for the debug surface; this is the in-process key for it.
function chatKeyOf(taskId: string | null): string {
  return taskId ?? ''
}

function chatEntryFor(taskId: string | null): ChatEntry {
  const key = chatKeyOf(taskId)
  let entry = chatSessions.get(key)
  if (!entry) {
    entry = { session: new ChatSession(), grounding: '' }
    chatSessions.set(key, entry)
  }
  return entry
}

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

// Per-category chat grounding. What each category contributes lives in
// src/core/domain/chatContext.ts; this is the transport-side wrapper.
//
// THE EGRESS BOUNDARY. Once a type has been granted external reach, this
// session can echo onward whatever it can see — so the full context stops
// being built for it (FR-029, contracts/plugin-grants.md §3). Filtering at the
// tool boundary would be too late: the content would already be in the prompt.
function chatContextFor(d: DatabaseSync, taskId: string): string | undefined {
  const task = getTask(d, taskId)
  if (!task) return undefined
  const def = effectiveTypeDef(d, task)
  return buildSessionContext({
    task,
    typeDef: def,
    purpose: 'interactive',
    fullContext: () => fullChatContext(d, task)
  })
}

function fullChatContext(d: DatabaseSync, task: Task): string | undefined {
  // A missing registry entry would silently thin the grounding, which is the
  // failure this replaced — so it is a registry lookup, never a fallback.
  return buildChatContext(effectiveKind(d, task), {
    task,
    preprocess: getPreprocess(d, task.id),
    workingContent: getNotes(d, task.id)?.content ?? null
  })
}

// What the grounding behind a conversation is worth, as a comparable string.
// The pre-process is the part that can move under an open conversation: it is
// written by a background job that may land — or be re-run — while the user is
// chatting.
function chatGroundingVersion(d: DatabaseSync, taskId: string | null): string {
  if (!taskId) return ''
  const p = getPreprocess(d, taskId)
  return p ? `${p.status}|${p.updatedAt}|${p.inputsHash}` : 'none'
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

// Typed by the event contract (src/shared/ipc.ts): the payload for a channel
// is whatever AppEvents says it is, so an implementation cannot satisfy a name
// with the wrong shape.
function broadcast<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
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
      const taskId = job.taskId
      broadcast(IPC.evSuggestionsUpdated, { taskId, suggestions: listSuggestions(d(), taskId) })
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

// Broadcast a task's new state, or nothing when it has since been deleted —
// the renderer's handler reads the payload, and a null would throw there rather
// than here.
function broadcastTask(taskId: string): void {
  const t = getTask(db!.db, taskId)
  if (t) broadcast(IPC.evTaskUpdated, t)
}

// The behaviour a task's type declares, or null when it declares none.
function declaredBehaviourForTask(d: DatabaseSync, task: Task): string | null {
  const def = defFor(d, task.type, task.customTypeKey)
  if (!def) return null
  try {
    return declaredWorkflow(def).finishBehaviour
  } catch {
    return null
  }
}

// Broadcast the newest activity record for a task. The renderer merges by id,
// so a null payload would be worse than no event at all — only a real record
// is sent.
function broadcastActivityFor(taskId: string): void {
  const rec = listIngest(db!.db).find((r) => r.taskId === taskId)
  if (rec) broadcast(IPC.evIngestUpdated, rec)
}

// The pending remote-change proposals (contracts/plugin-grants.md §4).
//
// In-memory: a proposal the user never confirmed is working state, not durable
// configuration, and a change that was never made leaving nothing behind is the
// safe direction. The MUTATOR is the only thing that can talk to a remote
// system, and it is reachable only from here — never from the model's tool
// surface.
const proposals = createProposalQueue(systemClock, () => randomUUID())

function proposalViews(): RemoteProposalView[] {
  return proposals.list().map((p) => ({
    id: p.id,
    server: p.server,
    operation: p.operation,
    target: p.target,
    summary: p.summary,
    payloadPreview: JSON.stringify(p.payload, null, 2),
    createdAt: p.createdAt
  }))
}

function broadcastProposals(): void {
  broadcast(IPC.evProposals, proposalViews())
}

// Resolve the effective type def for a task about to be created/edited.
function defFor(db: DatabaseSync, type: Task['type'] | undefined, customTypeKey: string | null | undefined): TaskTypeDef | null {
  return effectiveTypeDef(db, { type: type ?? 'plain', customTypeKey: customTypeKey ?? null })
}

// Adapters + services for a finish. Built per call so the store factory and
// the type-declared destinations always reflect the current state of the DB.
function finishDeps(): FinishDeps {
  const d = db!.db
  const language = loadSettings(d).uiLanguage
  return {
    language,
    paths: nodePathPort,
    storage: createSqliteStorage(d),
    storeFor: artifactStoreFor(),
    session: createAgentSessionAdapter(() => loadSettings(d)),
    clock: systemClock,
    notifier: createNotifier({
      toast: (text, opts) => broadcast(IPC.evToast, { message: text, view: opts?.view }),
      progress: (stepLabel, progress) =>
        broadcast(IPC.evJobProgress, {
          jobId: 'finish',
          kind: 'ingest',
          taskId: null,
          state: 'running',
          // The joiner is a message: its spacing and glyph differ by language.
          stepLabel: progress ? `${stepLabel}${message(language, 'common.stepJoiner')}${progress}` : stepLabel,
          error: null
        })
    }),
    taskTargetOverride: (task) =>
      typeof task.inputs.learningNotePath === 'string' ? task.inputs.learningNotePath : undefined,
    // deposit-then-curate hands the long-running curating agent to the queue,
    // which owns the activity record for that behaviour.
    enqueueCurate: (task) => {
      queue!.enqueueIngest(task.id, task.title, [])
    }
  }
}

// A handler that can refuse something the user did.
//
// The domain states its refusals as codes (src/core/i18n/issues.ts) because it
// has no language of its own; this is where the language is known on the way
// out, and where the code becomes a sentence. It has to happen before the
// throw: an `ipcRenderer.invoke` rejection arrives in the renderer as Electron's
// own wrapper around a string, and nothing structured survives that.
//
// Applied only to the handlers that can refuse user input. A handler left alone
// still works — `localizeThrown` passes anything that is not a code-carrying
// error through untouched — but a refusal from an unwrapped handler would reach
// the user as its key.
function handleCommand<C extends keyof AppCommands>(
  channel: C,
  fn: (args: AppCommands[C]['args']) => AppCommands[C]['result'] | Promise<AppCommands[C]['result']>
): void {
  ipcMain.handle(channel, async (_e, args) => {
    try {
      return await fn(args)
    } catch (e) {
      throw localizeThrown(e, loadSettings(db!.db).uiLanguage)
    }
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
  handleCommand(IPC.createTask, (args) => {
    const task = createTaskService(createSqliteStorage(d()), {
      listId: args.listId,
      title: args.title,
      notes: args.notes,
      type: args.type,
      customTypeKey: args.customTypeKey ?? null,
      inputs: args.inputs ?? {}
    })
    broadcast(IPC.evTaskUpdated, task)
    return task
  })
  handleCommand(IPC.updateTask, (args) => {
    // The routing rules live in the service; this handler only reports the
    // result and performs the background work the service asked for.
    const outcome = updateTaskService(createSqliteStorage(d()), args, loadSettings(d()))
    for (const work of outcome.enqueue) queue!.enqueue(work, outcome.task.id)
    broadcast(IPC.evTaskUpdated, outcome.task)
    return outcome.task
  })
  handleCommand(IPC.runPreprocess, (args) => {
    // The guards live in the service; this handler only acts on its decision.
    const outcome = runPreprocessService(createSqliteStorage(d()), args.id, loadSettings(d()))
    for (const work of outcome.enqueue) queue!.enqueue(work, outcome.task.id)
    broadcast(IPC.evTaskUpdated, outcome.task)
    return outcome.task
  })
  ipcMain.handle(IPC.deleteTask, (_e, args) => {
    serviceDeleteTask(d(), args.id)
    // A deleted task's conversation can never be reopened, so it is dropped
    // rather than kept for the life of the process.
    chatSessions.delete(chatKeyOf(args.id))
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
    const outcome = setMyDayService(createSqliteStorage(d()), args.id, args.inMyDay, loadSettings(d()))
    for (const work of outcome.enqueue) queue!.enqueue(work, outcome.task.id)
    broadcast(IPC.evTaskUpdated, outcome.task)
    return outcome.task
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
    broadcastTask(args.taskId)
    return notes
  })
  handleCommand(IPC.finishTask, async (args) => {
    // Finish is dispatched on the type's DECLARED behaviour, not on a hardcoded
    // category comparison (contracts/finish-behaviours.md). The service
    // validates and confines before anything is marked complete, so a bad
    // destination or a missing input is reported while the task is still
    // actionable.
    const stepKey = `finish:${args.id}`
    try {
      const outcome = await runFinishTask(finishDeps(), args.id)
      broadcast(IPC.evJobProgress, {
        jobId: stepKey,
        kind: 'ingest',
        taskId: args.id,
        state: 'done',
        stepLabel: null,
        error: null
      })
      rescheduleAlarms()
      broadcast(IPC.evTaskUpdated, outcome.task)
      broadcastActivityFor(args.id)
      return outcome.task
    } catch (e: any) {
      broadcast(IPC.evJobProgress, {
        jobId: stepKey,
        kind: 'ingest',
        taskId: args.id,
        state: 'failed',
        stepLabel: null,
        error: e?.message ?? String(e)
      })
      broadcastActivityFor(args.id)
      throw e
    }
  })
  ipcMain.handle(IPC.chooseFile, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle(IPC.chooseFolder, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]!
  })
  ipcMain.handle(IPC.importSkill, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return importSkillFolder(res.filePaths[0]!)
  })
  // handleCommand, not a bare ipcMain.handle: this path refuses in codes
  // (bad URL, 404, unsafe archive, missing SKILL.md) and the codes must be
  // phrased in the user's language before they cross the IPC boundary.
  handleCommand(IPC.importSkillGitHub, (args) => importSkillFromGitHub(args.url))
  ipcMain.handle(IPC.listTypes, () => listTypeDefs(d()))
  handleCommand(IPC.saveType, (args) => {
    const existing = args.type?.key ? getTypeDef(d(), args.type.key) : null
    const saved = existing ? updateTypeDef(d(), args.type) : createTypeDef(d(), args.type)
    broadcast(IPC.evTypesUpdated, listTypeDefs(d()))
    return saved
  })
  handleCommand(IPC.deleteType, (args) => {
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
  handleCommand(IPC.saveSettings, async (args) => {
    // The validation and the first-run rule live in the service.
    const saved = saveSettingsService(createSqliteStorage(d()), args.settings)
    // The user asked the app to keep mcp.json current. The save already
    // committed — a failed file write must not pretend the settings were lost,
    // but it must be reported (FR-024: a failure never presents as success).
    try {
      materializeMcpConfig(saved.mcpServers ?? [])
    } catch (e: any) {
      broadcast(IPC.evToast, {
        message: message(saved.uiLanguage, 'settings.mcp.materializeFailed', {
          error: e instanceof Error ? e.message : String(e)
        })
      })
    }
    await configureRuntimeFromSettings(saved)
    broadcast(IPC.evSettingsUpdated, saved)
    return saved
  })
  ipcMain.handle(IPC.listModels, (_e, provider: string) => listModelsForProvider(provider))
  ipcMain.handle(IPC.listProviders, () => listProviders())
  ipcMain.handle(IPC.testConnection, async (_e, settings: Settings) => testPrompt(settings, 'Reply with exactly: OK'))
  ipcMain.handle(IPC.sendChat, async (_e, args: { text: string; taskId?: string }) => {
    const settings = loadSettings(d())
    const taskId = args.taskId ?? null
    // Conversations are per-surface: the entry is created on the surface's
    // first message and kept for as long as the app runs, so a task's chat is
    // still there when the user comes back to it.
    const entry = chatEntryFor(taskId)
    const context = taskId ? chatContextFor(d(), taskId) : undefined
    // The same conversation with newer grounding: swap the context in rather
    // than restarting, so a pre-process that has just landed reaches the reply
    // without discarding the exchange so far.
    const grounding = chatGroundingVersion(d(), taskId)
    if (grounding !== entry.grounding) entry.session.refreshContext(context)
    entry.grounding = grounding
    try {
      const reply = await entry.session.send(
        args.text,
        settings,
        (delta) => broadcast(IPC.evChatDelta, { owner: taskId, delta }),
        context
      )
      broadcast(IPC.evChatDone, { owner: taskId, text: reply })
    } catch (e: any) {
      broadcast(IPC.evChatError, { owner: taskId, error: e?.message ?? String(e) })
    }
  })
  ipcMain.handle(IPC.resetChat, (_e, args: { taskId?: string }) => {
    const taskId = args?.taskId ?? null
    chatEntryFor(taskId).session.reset()
  })
  ipcMain.handle(IPC.dismissSuggestion, (_e, args) => {
    const s = dismissSuggestion(d(), args.suggestionId)
    broadcast(IPC.evSuggestionsUpdated, { taskId: s.taskId, suggestions: listSuggestions(d(), s.taskId) })
    return s
  })
  ipcMain.handle(IPC.getProposals, () => proposalViews())
  ipcMain.handle(IPC.confirmRemoteChange, async (_e, args: { proposalId: string }) => {
    // The per-change confirmation EXECUTION (mutating an external system from
    // this bar) is still deferred (research R7a): the MCP transport is now
    // live at the session seam for granted types, but this flow needs
    // out-of-model tool execution the adapter's public surface does not yet
    // offer. That is reported as a failure — never as a success (FR-024),
    // and phrased in the user's language rather than a hardcoded literal.
    const outcome = await proposals.confirm(args.proposalId, {
      apply: async () => ({
        ok: false,
        error: message(loadSettings(d()).uiLanguage, 'remote.confirmDeferred')
      })
    })
    broadcastProposals()
    if (!outcome.ok) broadcast(IPC.evToast, { message: outcome.error, view: 'activity' })
    return outcome
  })
  ipcMain.handle(IPC.dismissProposal, (_e, args: { proposalId: string }) => {
    proposals.dismiss(args.proposalId)
    broadcastProposals()
    return undefined
  })
  ipcMain.handle(IPC.getActivity, () => listIngest(d()))
  ipcMain.handle(IPC.retryIngest, async (_e, args) => {
    // Retry means "try that finish again", and what that takes depends on the
    // type's declared behaviour: a deposit-then-curate finish has a background
    // curating job to re-queue, while an inline behaviour just runs again. The
    // user's work is already on disk either way, so nothing is retyped (FR-027).
    const rec = listIngest(d()).find((r) => r.id === args.ingestId)
    const task = rec ? getTask(d(), rec.taskId) : null
    const behaviour = task ? declaredBehaviourForTask(d(), task) : null
    if (behaviour === 'deposit-then-curate') {
      queue!.retryIngest(args.ingestId)
      return undefined
    }
    if (task) {
      await runFinishTask(finishDeps(), task.id)
      broadcastActivityFor(task.id)
      broadcastTask(task.id)
    }
    return undefined
  })
}

// The window/taskbar icon. Same file electron-builder uses as the installer
// icon source (build/icon.png from directories.buildResources); resolved like
// the wiki guide — repo checkout first (dev), then the packaged extraResources
// copy next to the app.
function appIconPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), 'build', 'icon.png'),
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'icon.png') : undefined
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Beyond the Dialogue',
    icon: appIconPath(),
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

  // No argument: the data root resolves through the portability seam
  // (`paths.userDataDir()`), not through a direct Electron call here.
  const d = openDB()
  db = d
  migrate(d.db)
  ensureVault()
  // Converge the app-owned mcp.json with the settings on every startup — a
  // save that crashed between the commit and the file write leaves the copy
  // stale, and here it is rewritten from the source of truth. A failure must
  // not block boot; the file is an inspection copy.
  try {
    materializeMcpConfig(loadSettings(d.db).mcpServers ?? [])
  } catch (e) {
    console.warn('[mcp] could not write the app mcp.json:', e)
  }

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
