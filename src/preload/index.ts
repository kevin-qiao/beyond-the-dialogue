import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { RendererApi, JobProgressEvent, IngestProgressEvent, ToastPayload, ConversationDeltaEvent, ConversationUpdatedEvent, ArtifactsFiledEvent, RemoteProposalView } from '../shared/ipc'
import type { IngestRecord, List, RedactedSettings, SkillEntry, Task, TaskNote, TaskTypeDef } from '../shared/types'

const api: RendererApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  createList: (args) => ipcRenderer.invoke(IPC.createList, args),
  renameList: (args) => ipcRenderer.invoke(IPC.renameList, args),
  deleteList: (args) => ipcRenderer.invoke(IPC.deleteList, args),
  createTask: (args) => ipcRenderer.invoke(IPC.createTask, args),
  updateTask: (args) => ipcRenderer.invoke(IPC.updateTask, args),
  deleteTask: (args) => ipcRenderer.invoke(IPC.deleteTask, args),
  toggleTask: (args) => ipcRenderer.invoke(IPC.toggleTask, args),
  setMyDay: (args) => ipcRenderer.invoke(IPC.setMyDay, args),
  setTaskDone: (args) => ipcRenderer.invoke(IPC.setTaskDone, args),
  setAlarm: (args) => ipcRenderer.invoke(IPC.setAlarm, args),
  finishTask: (args) => ipcRenderer.invoke(IPC.finishTask, args),
  chooseFile: () => ipcRenderer.invoke(IPC.chooseFile),
  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  importSkill: () => ipcRenderer.invoke(IPC.importSkill) as Promise<SkillEntry | null>,
  importSkillFromGitHub: (url) => ipcRenderer.invoke(IPC.importSkillGitHub, { url }) as Promise<SkillEntry>,
  getProposals: () => ipcRenderer.invoke(IPC.getProposals),
  confirmRemoteChange: (args) => ipcRenderer.invoke(IPC.confirmRemoteChange, args),
  dismissProposal: (args) => ipcRenderer.invoke(IPC.dismissProposal, args),
  saveNote: (args) => ipcRenderer.invoke(IPC.saveNote, args),
  listTypes: () => ipcRenderer.invoke(IPC.listTypes),
  saveType: (args) => ipcRenderer.invoke(IPC.saveType, args),
  removeType: (args) => ipcRenderer.invoke(IPC.removeType, args),
  retryJob: (args) => ipcRenderer.invoke(IPC.retryJob, args),
  cancelJob: (args) => ipcRenderer.invoke(IPC.cancelJob, args),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (args) => ipcRenderer.invoke(IPC.saveSettings, args),
  listModels: (provider) => ipcRenderer.invoke(IPC.listModels, provider),
  listProviders: () => ipcRenderer.invoke(IPC.listProviders),
  testConnection: (settings) => ipcRenderer.invoke(IPC.testConnection, settings),
  conversationsList: (args) => ipcRenderer.invoke(IPC.conversationsList, args),
  conversationsCreate: (args) => ipcRenderer.invoke(IPC.conversationsCreate, args),
  conversationsSend: (args) => ipcRenderer.invoke(IPC.conversationsSend, args),
  conversationsMessages: (args) => ipcRenderer.invoke(IPC.conversationsMessages, args),
  conversationsDelete: (args) => ipcRenderer.invoke(IPC.conversationsDelete, args),
  getActivity: () => ipcRenderer.invoke(IPC.getActivity),
  retryIngest: (args) => ipcRenderer.invoke(IPC.retryIngest, args),
  undoCuration: (args) => ipcRenderer.invoke(IPC.undoCuration, args),
  attachmentsAddFromDialog: (args) => ipcRenderer.invoke(IPC.attachmentsAddFromDialog, args),
  attachmentsRemove: (args) => ipcRenderer.invoke(IPC.attachmentsRemove, args),
  attachmentsOpen: (args) => ipcRenderer.invoke(IPC.attachmentsOpen, args),
  onTaskUpdated: (cb) => {
    const h = (_e: unknown, t: Task) => cb(t)
    ipcRenderer.on(IPC.evTaskUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evTaskUpdated, h)
  },
  onListUpdated: (cb) => {
    const h = (_e: unknown, l: List) => cb(l)
    ipcRenderer.on(IPC.evListUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evListUpdated, h)
  },
  onJobProgress: (cb) => {
    const h = (_e: unknown, e: JobProgressEvent) => cb(e)
    ipcRenderer.on(IPC.evJobProgress, h)
    return () => ipcRenderer.removeListener(IPC.evJobProgress, h)
  },
  onSettingsUpdated: (cb) => {
    const h = (_e: unknown, s: RedactedSettings) => cb(s)
    ipcRenderer.on(IPC.evSettingsUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evSettingsUpdated, h)
  },
  onTypesUpdated: (cb) => {
    const h = (_e: unknown, types: TaskTypeDef[]) => cb(types)
    ipcRenderer.on(IPC.evTypesUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evTypesUpdated, h)
  },
  onToast: (cb) => {
    const h = (_e: unknown, data: ToastPayload) => cb(data)
    ipcRenderer.on(IPC.evToast, h)
    return () => ipcRenderer.removeListener(IPC.evToast, h)
  },
  onIngestUpdated: (cb) => {
    const h = (_e: unknown, rec: IngestRecord) => cb(rec)
    ipcRenderer.on(IPC.evIngestUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evIngestUpdated, h)
  },
  onIngestProgress: (cb) => {
    const h = (_e: unknown, e: IngestProgressEvent) => cb(e)
    ipcRenderer.on(IPC.evIngestProgress, h)
    return () => ipcRenderer.removeListener(IPC.evIngestProgress, h)
  },
  onArtifactsFiled: (cb) => {
    const h = (_e: unknown, e: ArtifactsFiledEvent) => cb(e)
    ipcRenderer.on(IPC.evArtifactsFiled, h)
    return () => ipcRenderer.removeListener(IPC.evArtifactsFiled, h)
  },
  onConversationDelta: (cb) => {
    const h = (_e: unknown, e: ConversationDeltaEvent) => cb(e)
    ipcRenderer.on(IPC.evConversationDelta, h)
    return () => ipcRenderer.removeListener(IPC.evConversationDelta, h)
  },
  onConversationUpdated: (cb) => {
    const h = (_e: unknown, e: ConversationUpdatedEvent) => cb(e)
    ipcRenderer.on(IPC.evConversationUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evConversationUpdated, h)
  },
  onOpenTask: (cb) => {
    const h = (_e: unknown, taskId: string) => cb(taskId)
    ipcRenderer.on(IPC.evOpenTask, h)
    return () => ipcRenderer.removeListener(IPC.evOpenTask, h)
  },
  onProposals: (cb) => {
    const h = (_e: unknown, p: RemoteProposalView[]) => cb(p)
    ipcRenderer.on(IPC.evProposals, h)
    return () => ipcRenderer.removeListener(IPC.evProposals, h)
  }
}

contextBridge.exposeInMainWorld('api', api)
