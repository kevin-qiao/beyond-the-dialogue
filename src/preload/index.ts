import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { RendererApi, JobProgressEvent, IngestProgressEvent, ToastPayload, ChatDeltaEvent, ChatDoneEvent, ChatErrorEvent } from '../shared/ipc'
import type { IngestRecord, List, Settings, SkillEntry, Suggestion, Task, TaskNote, TaskPreprocess, TaskTypeDef } from '../shared/types'

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
  runPreprocess: (args) => ipcRenderer.invoke(IPC.runPreprocess, args),
  finishTask: (args) => ipcRenderer.invoke(IPC.finishTask, args),
  chooseFile: () => ipcRenderer.invoke(IPC.chooseFile),
  importSkill: () => ipcRenderer.invoke(IPC.importSkill) as Promise<SkillEntry | null>,
  saveNote: (args) => ipcRenderer.invoke(IPC.saveNote, args),
  listTypes: () => ipcRenderer.invoke(IPC.listTypes),
  saveType: (args) => ipcRenderer.invoke(IPC.saveType, args),
  deleteType: (args) => ipcRenderer.invoke(IPC.deleteType, args),
  retryJob: (args) => ipcRenderer.invoke(IPC.retryJob, args),
  cancelJob: (args) => ipcRenderer.invoke(IPC.cancelJob, args),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (args) => ipcRenderer.invoke(IPC.saveSettings, args),
  listModels: (provider) => ipcRenderer.invoke(IPC.listModels, provider),
  listProviders: () => ipcRenderer.invoke(IPC.listProviders),
  testConnection: (settings) => ipcRenderer.invoke(IPC.testConnection, settings),
  sendChat: (args) => ipcRenderer.invoke(IPC.sendChat, args),
  resetChat: () => ipcRenderer.invoke(IPC.resetChat),
  dismissSuggestion: (args) => ipcRenderer.invoke(IPC.dismissSuggestion, args),
  getActivity: () => ipcRenderer.invoke(IPC.getActivity),
  retryIngest: (args) => ipcRenderer.invoke(IPC.retryIngest, args),
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
  onPreprocessUpdated: (cb) => {
    const h = (_e: unknown, p: TaskPreprocess) => cb(p)
    ipcRenderer.on(IPC.evPreprocessUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evPreprocessUpdated, h)
  },
  onSuggestionsUpdated: (cb) => {
    const h = (_e: unknown, s: Suggestion[]) => cb(s)
    ipcRenderer.on(IPC.evSuggestionsUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evSuggestionsUpdated, h)
  },
  onSettingsUpdated: (cb) => {
    const h = (_e: unknown, s: Settings) => cb(s)
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
  onChatDelta: (cb) => {
    const h = (_e: unknown, e: ChatDeltaEvent) => cb(e)
    ipcRenderer.on(IPC.evChatDelta, h)
    return () => ipcRenderer.removeListener(IPC.evChatDelta, h)
  },
  onChatDone: (cb) => {
    const h = (_e: unknown, e: ChatDoneEvent) => cb(e)
    ipcRenderer.on(IPC.evChatDone, h)
    return () => ipcRenderer.removeListener(IPC.evChatDone, h)
  },
  onChatError: (cb) => {
    const h = (_e: unknown, e: ChatErrorEvent) => cb(e)
    ipcRenderer.on(IPC.evChatError, h)
    return () => ipcRenderer.removeListener(IPC.evChatError, h)
  },
  onOpenTask: (cb) => {
    const h = (_e: unknown, taskId: string) => cb(taskId)
    ipcRenderer.on(IPC.evOpenTask, h)
    return () => ipcRenderer.removeListener(IPC.evOpenTask, h)
  }
}

contextBridge.exposeInMainWorld('api', api)
