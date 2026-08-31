// Shared domain types used by main, preload, and renderer.

// ---- Task management ----

export type TaskType = 'plain' | 'paper_reading'

export type AnalysisStatus =
  | 'none'
  | 'queued'
  | 'running'
  | 'ready'
  | 'abstract_only'
  | 'failed'

export type AnalysisLevel = 'full' | 'abstract' | 'metadata'

export type MismatchState = 'none' | 'warning' | 'confirmed' | 'corrected'

export interface List {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Task {
  id: string
  listId: string
  title: string
  notes: string
  type: TaskType
  completed: boolean
  completedAt: string | null
  inMyDay: boolean
  myDayAddedAt: string | null
  // paper-reading enrichment fields
  link: string | null
  paperTitle: string | null
  analysisLevel: AnalysisLevel | null
  analysisStatus: AnalysisStatus
  mismatchState: MismatchState
  analysisError: string | null
  pdfPath: string | null
  // audit
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Suggestion {
  id: string
  taskId: string
  text: string
  dismissed: boolean
  createdAt: string
}

// ---- Settings ----

export interface Settings {
  provider: string
  model: string
  apiKey: string | null
  wikiPath: string
  defaultListId: string | null
  maxConcurrentJobs: number
  showWelcome: boolean
}

// ---- Jobs ----

export type JobKind = 'analysis' | 'suggestion' | 'ingest'
export type JobState = 'queued' | 'running' | 'done' | 'failed'

export interface JobRecord {
  id: string
  kind: JobKind
  taskId: string | null
  state: JobState
  stepLabel: string | null
  progress: string | null
  error: string | null
  attempts: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

// ---- Paper analysis ----

export interface ReadingSuggestion {
  id: string
  kind: 'order' | 'effort' | 'question'
  title: string
  body: string
}

export interface PaperAnalysis {
  taskId: string
  level: AnalysisLevel
  status: AnalysisStatus
  tldr: string
  contributions: string[]
  method: string
  results: string
  prerequisites: string[]
  suggestions: ReadingSuggestion[]
  updatedAt: string
}

// ---- Notes ----

export interface ReadingNotes {
  taskId: string
  notePath: string
  content: string
  updatedAt: string
}

// ---- Wiki / ingest ledger ----

export type IngestState = 'queued' | 'running' | 'done' | 'failed'

export interface IngestRecord {
  id: string
  taskId: string
  taskTitle: string
  state: IngestState
  depositFiles: string[]
  touchedFiles: string[]
  error: string | null
  attempts: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

// ---- Debug chat ----

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---- Views ----

export interface MyDayTask extends Task {
  suggestions: Suggestion[]
  analysis: PaperAnalysis | null
}

export interface AppSnapshot {
  lists: List[]
  tasks: Task[]
  suggestions: Suggestion[]
  analyses: Record<string, PaperAnalysis>
  notes: Record<string, ReadingNotes>
  settings: Settings
  aiConfigured: boolean
  ingestHistory: IngestRecord[]
}
