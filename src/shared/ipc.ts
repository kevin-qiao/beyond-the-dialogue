import type { AppSnapshot, List, PaperAnalysis, ReadingNotes, Settings, Suggestion, Task } from './types'

// IPC channel names. Commands are renderer -> main invokes; events are
// main -> renderer pushes.

export const IPC = {
  // commands
  getSnapshot: 'app:get-snapshot',
  createList: 'lists:create',
  renameList: 'lists:rename',
  deleteList: 'lists:delete',
  createTask: 'tasks:create',
  updateTask: 'tasks:update',
  deleteTask: 'tasks:delete',
  toggleTask: 'tasks:toggle',
  setMyDay: 'tasks:set-my-day',
  setTaskDone: 'tasks:set-done',
  saveNote: 'notes:save',
  attachPdf: 'paper:attach-pdf',
  requestReanalysis: 'paper:request-reanalysis',
  resolveMismatch: 'paper:resolve-mismatch',
  finishTask: 'paper:finish',
  choosePdf: 'dialog:choose-pdf',
  retryJob: 'jobs:retry',
  cancelJob: 'jobs:cancel',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  listModels: 'ai:list-models',
  listProviders: 'ai:list-providers',
  testConnection: 'ai:test-connection',
  sendChat: 'chat:send',
  resetChat: 'chat:reset',
  dismissSuggestion: 'suggestions:dismiss',
  getActivity: 'wiki:activity',
  retryIngest: 'wiki:retry-ingest',
  // events (main -> renderer)
  evTaskUpdated: 'ev:task-updated',
  evListUpdated: 'ev:list-updated',
  evJobProgress: 'ev:job-progress',
  evAnalysisUpdated: 'ev:analysis-updated',
  evSuggestionsUpdated: 'ev:suggestions-updated',
  evSnapshot: 'ev:snapshot',
  evToast: 'ev:toast',
  evIngestUpdated: 'ev:ingest-updated',
  evIngestProgress: 'ev:ingest-progress',
  evChatDelta: 'ev:chat-delta',
  evChatDone: 'ev:chat-done',
  evChatError: 'ev:chat-error'
} as const

export interface JobProgressEvent {
  jobId: string
  kind: string
  taskId: string | null
  state: string
  stepLabel: string | null
  error: string | null
}

export interface IngestProgressEvent {
  ingestId: string
  taskId: string | null
  stepLabel: string | null
}

export interface ToastPayload {
  message: string
  view?: 'activity'
}

export interface ChatDeltaEvent {
  delta: string
}

export interface ChatDoneEvent {
  text: string
}

export interface ChatErrorEvent {
  error: string
}

export interface CreateListArgs {
  name: string
}

export interface CreateTaskArgs {
  listId: string
  title: string
  notes?: string
  type: 'plain' | 'paper_reading'
  link?: string
}

export interface UpdateTaskArgs {
  id: string
  title?: string
  notes?: string
  link?: string
}

export interface SaveNoteArgs {
  taskId: string
  content: string
}

export interface AttachPdfArgs {
  taskId: string
  pdfPath: string
}

export interface SaveSettingsArgs {
  settings: Settings
}

// The API surface exposed on window.api by the preload script.
export interface RendererApi {
  getSnapshot: () => Promise<AppSnapshot>
  createList: (args: CreateListArgs) => Promise<List>
  renameList: (args: { id: string; name: string }) => Promise<List>
  deleteList: (args: { id: string }) => Promise<void>
  createTask: (args: CreateTaskArgs) => Promise<Task>
  updateTask: (args: UpdateTaskArgs) => Promise<Task>
  deleteTask: (args: { id: string }) => Promise<void>
  toggleTask: (args: { id: string }) => Promise<Task>
  setMyDay: (args: { id: string; inMyDay: boolean }) => Promise<Task>
  setTaskDone: (args: { id: string; done: boolean }) => Promise<Task>
  saveNote: (args: SaveNoteArgs) => Promise<ReadingNotes>
  attachPdf: (args: AttachPdfArgs) => Promise<Task>
  requestReanalysis: (args: { id: string }) => Promise<Task>
  resolveMismatch: (args: { id: string; action: 'confirm' | 'correct' | 'attach' }) => Promise<Task>
  finishTask: (args: { id: string }) => Promise<Task>
  choosePdf: () => Promise<string | null>
  retryJob: (args: { jobId: string }) => Promise<void>
  cancelJob: (args: { jobId: string }) => Promise<void>
  getSettings: () => Promise<Settings>
  saveSettings: (args: SaveSettingsArgs) => Promise<Settings>
  listModels: (provider: string) => Promise<string[]>
  listProviders: () => Promise<string[]>
  testConnection: (settings: Settings) => Promise<{ ok: boolean; text?: string; error?: string }>
  sendChat: (text: string) => Promise<void>
  resetChat: () => Promise<void>
  dismissSuggestion: (args: { suggestionId: string }) => Promise<Suggestion>
  getActivity: () => Promise<import('./types').IngestRecord[]>
  retryIngest: (args: { ingestId: string }) => Promise<void>
  // subscriptions
  onTaskUpdated: (cb: (t: Task) => void) => () => void
  onListUpdated: (cb: (l: List) => void) => () => void
  onJobProgress: (cb: (e: JobProgressEvent) => void) => () => void
  onAnalysisUpdated: (cb: (a: PaperAnalysis) => void) => () => void
  onSuggestionsUpdated: (cb: (s: Suggestion[]) => void) => () => void
  onToast: (cb: (t: ToastPayload) => void) => () => void
  onIngestUpdated: (cb: (rec: import('./types').IngestRecord) => void) => () => void
  onIngestProgress: (cb: (e: IngestProgressEvent) => void) => () => void
  onChatDelta: (cb: (e: ChatDeltaEvent) => void) => () => void
  onChatDone: (cb: (e: ChatDoneEvent) => void) => () => void
  onChatError: (cb: (e: ChatErrorEvent) => void) => () => void
}
