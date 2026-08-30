import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { RendererApi, JobProgressEvent, IngestProgressEvent, ToastPayload } from '../shared/ipc'
import type { IngestRecord, List, PaperAnalysis, Suggestion, Task } from '../shared/types'

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
  saveNote: (args) => ipcRenderer.invoke(IPC.saveNote, args),
  attachPdf: (args) => ipcRenderer.invoke(IPC.attachPdf, args),
  requestReanalysis: (args) => ipcRenderer.invoke(IPC.requestReanalysis, args),
  resolveMismatch: (args) => ipcRenderer.invoke(IPC.resolveMismatch, args),
  finishTask: (args) => ipcRenderer.invoke(IPC.finishTask, args),
  choosePdf: () => ipcRenderer.invoke(IPC.choosePdf),
  retryJob: (args) => ipcRenderer.invoke(IPC.retryJob, args),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (args) => ipcRenderer.invoke(IPC.saveSettings, args),
  listModels: (provider) => ipcRenderer.invoke(IPC.listModels, provider),
  testConnection: (settings) => ipcRenderer.invoke(IPC.testConnection, settings),
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
  onAnalysisUpdated: (cb) => {
    const h = (_e: unknown, a: PaperAnalysis) => cb(a)
    ipcRenderer.on(IPC.evAnalysisUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evAnalysisUpdated, h)
  },
  onSuggestionsUpdated: (cb) => {
    const h = (_e: unknown, s: Suggestion[]) => cb(s)
    ipcRenderer.on(IPC.evSuggestionsUpdated, h)
    return () => ipcRenderer.removeListener(IPC.evSuggestionsUpdated, h)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
