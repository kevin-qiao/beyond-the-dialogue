import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { AlarmScheduler } from './alarms'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { openDB, migrate, loadSettings, saveSettings, listAttachments, type DB } from './db'
import { materializeMcpConfig } from './mcpConfigFile'
import { ensureVault, writeNote } from './wiki/vault'
import {
  serviceCreateList,
  serviceDeleteList,
  serviceDeleteTask,
  serviceListForList,
  serviceLists,
  serviceRenameList,
  serviceSetAlarm,
  serviceToggleTask,
  serviceUpdateTask,
  rolloverMyDay
} from './tasks'
import { JobQueue } from './job-queue'
import { runIngestJob } from './wiki/ingest'
import { configureRuntimeFromSettings, isConfigured, listModelsForProvider, listProviders, testPrompt } from './ai/agent-runtime'
import { runChatTurn } from './ai/chat'
import { getNotes, listIngest, getTask, saveNotes, getJob, getAttachment } from './db'
import { notePathFor } from './wiki/vault'
import { createTypeDef, deleteTypeDef, effectiveTypeDef, getTypeDef, listTypeDefs, updateTypeDef } from './types'
import { importSkillFolder } from './skills'
import { importSkillFromGitHub } from './skills-github'
import { IPC, type AppCommands, type AppEvents } from '../shared/ipc'
import type { AppSnapshot, Attachment, RedactedSettings, Settings, Task, TaskTypeDef } from '../shared/types'
import type { RemoteProposalView } from '../shared/ipc'
import { finishTask as runFinishTask, type FinishDeps } from '../core/services/finishService'
import { declaredWorkflow } from '../core/domain/taskType'
import { saveSettings as saveSettingsService, splitInput, toRedacted } from '../core/services/settingsService'
import { isAssistantEnabled } from '../core/domain/assistant'
import { aiReadiness } from '../core/domain/config'
import { getProviderKey, readSecrets, stripStaleAuthFile, getMcpEnv, storeMcpEnv, storeProviderKey } from './secrets'
import { loadRuntimeSettings } from './runtimeSettings'
import { createAttachmentStore } from './adapters/attachments'
import { LocalizedError } from '../core/i18n/issues'
import { createProposalQueue } from '../core/domain/grant'
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  sendTurn
} from '../core/services/conversationService'
import type { ConversationTurnPort } from '../core/ports/conversations'
import { createSqliteConversationStore } from './adapters/sqlite/conversationStore'
import { localeOf, message } from '../core/i18n'
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
// The in-memory per-surface transcript map is deleted (T026/D5): conversations
// are stored state in the v14 tables, addressed by their own id, and a turn
// builds one short-lived model call from the stored history. Nothing chat-
// shaped is retained in this process between turns.
let alarms: AlarmScheduler | null = null

function rescheduleAlarms(): void {
  alarms?.reschedule()
}

// OS notification for a fired alarm (spec task-notifications): firing works
// whether the app is focused or not; clicking focuses the window and opens
// the task in the renderer.
function raiseAlarmNotification(fire: { taskId: string; title: string; dueAt: string; overdue: boolean }): void {
  if (!Notification.isSupported()) return
  // FR-008/FR-010: the notification names the task either way; a missed-while-
  // closed re-raise says OVERDUE and names the original date-time — in the
  // language the app is set to. These are the app's own words, so they come
  // from the catalog, not from a literal (the literal census cannot see a
  // `new Notification({…})` argument — this line is written from keys on
  // purpose; see CLAUDE.md's language section).
  const d = db!.db
  const language = loadSettings(d).uiLanguage
  let title = 'Beyond the Dialogue'
  let body = fire.title
  if (fire.overdue) {
    title = message(language, 'alarm.overdue.title')
    const when = new Date(fire.dueAt).toLocaleString(localeOf(language))
    body = message(language, 'alarm.overdue.body', { title: fire.title, when })
  }
  const n = new Notification({ title, body })
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

// The conversation turn port (research D5): availability is read from the
// declared switch and the configured model service at call time, and a turn
// is ONE short-lived stream through the existing SDK seam (runChatTurn →
// streamChat) — nothing is retained afterwards. Grounding and its egress
// wrapper live in the conversation service, built from the store's read-only
// task material (FR-010/FR-011).
function conversationTurn(d: DatabaseSync): ConversationTurnPort {
  return {
    availability: () => {
      if (!isAssistantEnabled(loadSettings(d))) return 'off'
      return isConfigured(loadRuntimeSettings(d)) ? 'ready' : 'not-configured'
    },
    run: ({ history, onDelta }) => runChatTurn(loadRuntimeSettings(d), history, onDelta)
  }
}

/** Attachments ride the task aggregate (contract: "new attachments ride
 *  `ev:task-updated` … no separate channel until needed"). */
function withAttachments(d: DatabaseSync, task: Task): Task {
  return { ...task, attachments: listAttachments(d, task.id) }
}

function snapshotSettings(d: DatabaseSync): RedactedSettings {
  // The secret store is consulted for PRESENCE only (hasEnv); the values
  // themselves never enter the returned object (FR-020).
  return toRedacted(loadSettings(d), readSecrets().secrets)
}

function buildSnapshot(): AppSnapshot {
  const d = db!.db
  const lists = serviceLists(d)
  const tasks = serviceListForList(d).map((t) => withAttachments(d, t))
  const notes: AppSnapshot['notes'] = {}
  for (const t of tasks) {
    const n = getNotes(d, t.id)
    if (n) notes[t.id] = n
  }
  const settings = loadSettings(d)
  return {
    lists,
    tasks,
    notes,
    settings: toRedacted(settings, readSecrets().secrets),
    taskTypes: listTypeDefs(d),
    // FR-016: three declared states, not a boolean (feature 001).
    aiReadiness: aiReadiness(settings),
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
      if (t) broadcast(IPC.evTaskUpdated, withAttachments(d(), t))
    }
  })
  // The retired preprocess/suggestion job events are gone with the engines
  // (D4): the queue now carries one kind, `ingest`, whose events follow.
  q.on('failed', (job) => {
    if (job.taskId) {
      const t = getTask(d(), job.taskId)
      if (t) broadcast(IPC.evTaskUpdated, withAttachments(d(), t))
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
  if (t) broadcast(IPC.evTaskUpdated, withAttachments(db!.db, t))
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
  const settings = loadSettings(d)
  const language = settings.uiLanguage
  return {
    language,
    // D1: while the switch is off only `complete-only` is reachable; the
    // refusal happens inside the service, before anything is marked complete.
    assistantEnabled: isAssistantEnabled(settings),
    paths: nodePathPort,
    storage: createSqliteStorage(d),
    storeFor: artifactStoreFor(),
    session: createAgentSessionAdapter(() => loadRuntimeSettings(d)),
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

// The assistant switch's boundary guard (feature 001, T044): the assistant
// channels stay REGISTERED — a renderer built against the typed map must not
// fail on a missing channel — but refuse, with a localized code rather than a
// crash, while the declared switch says off. `tasks:finish` is deliberately
// NOT here: completing a task is board work, and only the behaviours beyond
// `complete-only` are gated (inside finishService, on the declaration).
function requireAssistant(d: DatabaseSync): void {
  if (!isAssistantEnabled(loadSettings(d))) throw new LocalizedError([{ key: 'assistant.disabled' }])
}

/**
 * The specific failure the check reported (FR-012: "success, authentication
 * failure, unreachable, bad response"). The provider's own text is kept as
 * the record's `reason` — the precedent of `tasks.preprocess_error`: what
 * happened, in the words it happened in — but the three-way distinction is
 * decided HERE, from the text, so the state survives the language it was
 * written in.
 */
function classifyCheckFailure(errorText: string | undefined): string {
  const t = (errorText ?? '').toLowerCase()
  if (/401|403|unauthorized|invalid api key|authentication|credential|no api key|no model available/.test(t)) {
    return 'authentication failed'
  }
  if (/429|50[0-9]|timeout|timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|connection/.test(t)) {
    return 'the service could not be reached'
  }
  return 'the service returned a bad response'
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
      background: args.background,
      target: args.target,
      notes: args.notes,
      type: args.type,
      customTypeKey: args.customTypeKey ?? null,
      inputs: args.inputs ?? {}
    })
    const agg = withAttachments(d(), task)
    broadcast(IPC.evTaskUpdated, agg)
    return agg
  })
  handleCommand(IPC.updateTask, (args) => {
    // The routing rules live in the service; this handler only reports the
    // result and performs the background work the service asked for.
    const outcome = updateTaskService(createSqliteStorage(d()), args, loadSettings(d()))
    for (const work of outcome.enqueue) queue!.enqueue(work, outcome.task.id)
    const agg = withAttachments(d(), outcome.task)
    broadcast(IPC.evTaskUpdated, agg)
    return agg
  })
  ipcMain.handle(IPC.deleteTask, (_e, args) => {
    serviceDeleteTask(d(), args.id)
    // A deletion is final: the task, its alarm, and its attachments are gone
    // (FR-004 as clarified). The alarm consumption works through the
    // `deleted_at` filter in AlarmScheduler.pending() — nothing to do here.
    createAttachmentStore(d()).purgeForTask(args.id)
    // A deletion is final for conversations too (data-model: deleting the
    // task deletes its conversations, as 001 FR-004): the tombstone keeps the
    // task out of every view, and its exchanges are dropped with it.
    const convStore = createSqliteConversationStore(d())
    for (const c of listConversations(convStore, args.id)) deleteConversation(convStore, c.id)
    rescheduleAlarms()
    broadcast(IPC.evTaskUpdated, { id: args.id, deleted: true })
    return undefined
  })

  // ---- attachments (feature 001, T024) ----
  //
  // The dialog opens here, in main, reusing the `dialog:choose-file` pattern
  // but with NO markdown filter — an attachment is any file (research D2).
  // The handlers are wrapped with handleCommand so the refusals arrive as
  // localized codes and "the task survives intact on refusal" (contract).

  handleCommand(IPC.attachmentsAddFromDialog, async (args) => {
    const task = getTask(d(), args.taskId)
    if (!task) throw new Error('task not found')
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] })
    if (res.canceled || res.filePaths.length === 0) return null
    const stored = createAttachmentStore(d()).copyIn(args.taskId, res.filePaths[0]!)
    broadcastTask(args.taskId)
    return stored
  })
  handleCommand(IPC.attachmentsRemove, (args) => {
    // The task is re-broadcast so its attachment aggregate refreshes in the
    // renderer; the row lookup happens before the delete.
    const row = getAttachment(d(), args.attachmentId)
    createAttachmentStore(d()).remove(args.attachmentId)
    if (row) broadcastTask(row.taskId)
    return undefined
  })
  handleCommand(IPC.attachmentsOpen, async (args) => {
    const resolved = createAttachmentStore(d()).resolveStored(args.attachmentId)
    if (!resolved) throw new LocalizedError([{ key: 'attachment.missing' }])
    // shell.openPath answers '' on success and an error string otherwise —
    // surfacing it is better than a click that silently does nothing.
    const err = await shell.openPath(resolved.absPath)
    if (err) throw new Error(err)
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
    const agg = withAttachments(d(), outcome.task)
    broadcast(IPC.evTaskUpdated, agg)
    return agg
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
  handleCommand(IPC.setAlarm, (args) => {
    // FR-007: a past time is refused with a code at the service edge — the
    // task and its existing alarm stay exactly as they were.
    const task = serviceSetAlarm(d(), args.id, args.alarmAt ?? null)
    rescheduleAlarms()
    const agg = withAttachments(d(), task)
    broadcast(IPC.evTaskUpdated, agg)
    return agg
  })
  ipcMain.handle(IPC.saveNote, (_e, args) => {
    ensureVault()
    writeNote(args.taskId, args.content)
    const notes = saveNotes(d(), { taskId: args.taskId, notePath: notePathFor(args.taskId), content: args.content })
    broadcastTask(args.taskId)
    return notes
  })
  handleCommand(IPC.finishTask, async (args) => {
    // Finish is dispatched on the type's DECLARED behaviour and the user's
    // MODE choice (contracts/document-assist-ipc.md). The service validates,
    // refuses a blank draft, and confines the destination before anything is
    // marked complete, so a bad destination or a missing input is reported
    // while the task is still actionable — localized by handleCommand.
    const stepKey = `finish:${args.taskId}`
    try {
      const outcome = await runFinishTask(finishDeps(), args.taskId, { mode: args.mode })
      broadcast(IPC.evJobProgress, {
        jobId: stepKey,
        kind: 'ingest',
        taskId: args.taskId,
        state: 'done',
        stepLabel: null,
        error: null
      })
      rescheduleAlarms()
      const agg = withAttachments(d(), outcome.task)
      broadcast(IPC.evTaskUpdated, agg)
      // The contract event: after a finish write succeeds, the surface learns
      // where the filed copy went and which path ran.
      if (outcome.report.artifact) {
        broadcast(IPC.evArtifactsFiled, {
          taskId: args.taskId,
          path: outcome.report.artifact.path,
          store: outcome.report.artifact.store,
          mode: outcome.mode
        })
      }
      broadcastActivityFor(args.taskId)
      return outcome.report
    } catch (e: any) {
      broadcast(IPC.evJobProgress, {
        jobId: stepKey,
        kind: 'ingest',
        taskId: args.taskId,
        state: 'failed',
        stepLabel: null,
        error: e?.message ?? String(e)
      })
      broadcastActivityFor(args.taskId)
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
  // types:save (contract): family-scoped validation runs in the registry
  // service; a refusal returns { ok: false, issues } with the sentences
  // phrased in the user's language rather than throwing. No command exposes
  // or writes a grants field (D9): upsertType persists the empty default
  // whatever the payload carried.
  ipcMain.handle(IPC.saveType, (_e, args: { type: TaskTypeDef }) => {
    try {
      const existing = args.type?.key ? getTypeDef(d(), args.type.key) : null
      if (existing) updateTypeDef(d(), args.type)
      else createTypeDef(d(), args.type)
      broadcast(IPC.evTypesUpdated, listTypeDefs(d()))
      return { ok: true }
    } catch (e) {
      const localized = localizeThrown(e, loadSettings(d()).uiLanguage)
      return { ok: false, issues: [localized instanceof Error ? localized.message : String(localized)] }
    }
  })
  // types:remove (contract): tasks using the Type are re-homed to plain —
  // each re-home is broadcast (contract Events: task.updated "on re-home, on
  // Type removal") and the result names where they went.
  handleCommand(IPC.removeType, (args) => {
    const rehomed = deleteTypeDef(d(), args.key)
    for (const taskId of rehomed) broadcastTask(taskId)
    broadcast(IPC.evTypesUpdated, listTypeDefs(d()))
    return rehomed.length > 0 ? { ok: true, rehomedTo: 'plain' as const } : { ok: true }
  })
  handleCommand(IPC.cancelJob, (args) => {
    requireAssistant(d())
    queue!.cancel(args.jobId)
    return undefined
  })
  handleCommand(IPC.retryJob, (args) => {
    requireAssistant(d())
    const job = getJob(d(), args.jobId)
    if (!job) throw new Error('job not found')
    queue!.retryJob(args.jobId)
    return undefined
  })
  ipcMain.handle(IPC.getSettings, () => snapshotSettings(d()))
  handleCommand(IPC.saveSettings, async (args) => {
    // The write-only secret merge (contract): the payload MAY carry a key and
    // env values; present ⇒ store them in the secret store, absent/empty ⇒
    // keep the existing ones (never "clear by re-save"). What reaches the
    // settings table is presence only.
    const { settings: nonSecret, secrets } = splitInput(args.settings, readSecrets().secrets)
    if (secrets.providerKey) storeProviderKey(secrets.providerKey.provider, secrets.providerKey.value)
    for (const [server, env] of Object.entries(secrets.mcpEnv)) storeMcpEnv(server, env)

    // The validation and the first-run rule live in the service.
    const saved = saveSettingsService(createSqliteStorage(d()), nonSecret)
    // mcp.json is re-merged with env from the secret store: the rows carry
    // shape, the store carries values, the file is the standard shape again
    // (T047) for 002's adapter and for the user's inspection.
    try {
      materializeMcpConfig(saved.mcpServers ?? [], (name) => getMcpEnv(name))
    } catch (e: any) {
      broadcast(IPC.evToast, {
        message: message(saved.uiLanguage, 'settings.mcp.materializeFailed', {
          error: e instanceof Error ? e.message : String(e)
        })
      })
    }
    await configureRuntimeFromSettings(loadRuntimeSettings(d()))
    const redacted = toRedacted(saved, readSecrets().secrets)
    broadcast(IPC.evSettingsUpdated, redacted)
    return redacted
  })
  ipcMain.handle(IPC.listModels, (_e, provider: string) => listModelsForProvider(provider))
  ipcMain.handle(IPC.listProviders, () => listProviders())
  handleCommand(IPC.testConnection, async (args) => {
    // The request is RedactedSettings (guard: no request carries a secret);
    // the key is resolved main-side from the machine-bound store.
    void args
    const stored0 = loadSettings(d())
    let result: { ok: boolean; text?: string; error?: string }
    if (stored0.hasApiKey && !getProviderKey(stored0.provider)) {
      // The folder moved: the value died with the old machine (D4). The
      // re-enter state is the failure, named — first use asks, exactly once
      // (FR-021/SC-008).
      result = { ok: false, error: message(stored0.uiLanguage, 'settings.secret.reenterRequired') }
    } else {
      result = await testPrompt(loadRuntimeSettings(d()), 'Reply with exactly: OK')
    }
    // FR-012: report the outcome SPECIFICALLY, and remember it — the board's
    // readiness state is the stored verdict (FR-016), so a failed check
    // survives the save exactly as today, and changes nothing else (US3-AC3).
    const stored = loadSettings(d())
    stored.lastCheck = {
      state: result.ok ? 'ok' : 'failed',
      ...(result.ok ? {} : { reason: classifyCheckFailure(result.error) }),
      checkedAt: new Date().toISOString()
    }
    saveSettings(d(), stored)
    broadcast(IPC.evSettingsUpdated, toRedacted(stored, readSecrets().secrets))
    return result
  })
  // ---- conversations (feature 002, US2) ----
  //
  // Available on ANY task (FR-008) and NOT assistant-gated for reading: the
  // history is the user's own record. A send while off/unconfigured does not
  // throw — it returns the stated reason (US2-AC3), so the surface can say
  // plainly why it is unavailable while the board carries on.
  handleCommand(IPC.conversationsList, (args) => listConversations(createSqliteConversationStore(d()), args.taskId))
  handleCommand(IPC.conversationsCreate, (args) => createConversation(createSqliteConversationStore(d()), args.taskId))
  handleCommand(IPC.conversationsMessages, (args) => listMessages(createSqliteConversationStore(d()), args.conversationId))
  handleCommand(IPC.conversationsDelete, (args) => {
    deleteConversation(createSqliteConversationStore(d()), args.conversationId)
    return { ok: true }
  })
  handleCommand(IPC.conversationsSend, async (args) => {
    const store = createSqliteConversationStore(d())
    const conv = store.get(args.conversationId)
    if (!conv) throw new Error('conversation not found')
    const outcome = await sendTurn(
      { store, turn: conversationTurn(d()), language: loadSettings(d()).uiLanguage },
      { conversationId: args.conversationId, content: args.content },
      {
        // Deltas stream against their conversation; the stored turn then
        // arrives as conversation.updated — no delta exists without its
        // stored message behind it (contract Events).
        onDelta: (delta) => broadcast(IPC.evConversationDelta, { conversationId: args.conversationId, delta }),
        onStored: (m) => broadcast(IPC.evConversationUpdated, { taskId: conv.taskId, conversationId: conv.id, message: m })
      }
    )
    if (!outcome.ok) return { ok: false, error: outcome.error }
    return { ok: true, message: outcome.message }
  })
  handleCommand(IPC.getProposals, () => {
    requireAssistant(d())
    return proposalViews()
  })
  handleCommand(IPC.confirmRemoteChange, async (args: { proposalId: string }) => {
    requireAssistant(d())
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
  handleCommand(IPC.dismissProposal, (args: { proposalId: string }) => {
    requireAssistant(d())
    proposals.dismiss(args.proposalId)
    broadcastProposals()
    return undefined
  })
  handleCommand(IPC.getActivity, () => {
    requireAssistant(d())
    return listIngest(d())
  })
  handleCommand(IPC.retryIngest, async (args) => {
    requireAssistant(d())
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
    materializeMcpConfig(loadSettings(d.db).mcpServers ?? [], (name) => getMcpEnv(name))
  } catch (e) {
    console.warn('[mcp] could not write the app mcp.json:', e)
  }

  // Day rollover on first open after a date change.
  rolloverMyDay(d.db)

  queue = new JobQueue(d.db, loadSettings(d.db).maxConcurrentJobs)
  // FR-021 (001's T006, carried): the assistant job kind is REGISTERED ONLY
  // while the declared switch says on — registration itself is the
  // reachability, so no session can run while off. The queue carries exactly
  // one kind since feature 002 (D4): `ingest`, the curation run. The retired
  // preprocess/suggestion rows are history — requeueInterrupted leaves them
  // untouched because no handler is registered for them.
  if (isAssistantEnabled(loadSettings(d.db))) {
    queue.register('ingest', runIngestJob)
  }
  wireJobEvents(queue)
  queue.requeueInterrupted()

  // Alarms: raise missed ones once, arm the next future one (design D7).
  alarms = new AlarmScheduler(d.db, raiseAlarmNotification)
  alarms.start()

  // T041a: the SDK reads its own `auth.json` at its initiative; when the
  // gated store yields no key, any plaintext mirror left in that file is
  // removed BEFORE any runtime use — otherwise a copied folder authenticates
  // silently and SC-008's re-enter promise is void.
  const startup = loadSettings(d.db)
  if (startup.hasApiKey && !getProviderKey(startup.provider)) {
    stripStaleAuthFile()
  }
  // Ensure the configured key is applied to the runtime at startup — from
  // the gated store, not the settings table.
  await configureRuntimeFromSettings(loadRuntimeSettings(d.db))

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
