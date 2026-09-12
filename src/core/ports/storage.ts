import type { IngestRecord, Settings, Task, TaskNote, TaskPreprocess, TaskTypeDef } from '../../shared/types'

// StoragePort — the repository seam. Services depend on this, never on a
// database handle, which is what lets a second host substitute storage without
// moving domain logic again (contracts/app-client.md §1).
//
// Deliberately narrow: it lists what the services actually need, not
// everything the SQLite adapter can do.

export interface ActivityRecordInput {
  taskId: string
  taskTitle: string
  depositFiles: string[]
}

export interface ActivityPatch {
  state?: IngestRecord['state']
  error?: string | null
  touchedFiles?: string[]
  depositFiles?: string[]
  startedAt?: string | null
  finishedAt?: string | null
  attempts?: number
}

export interface CreateTaskInput {
  listId: string
  title: string
  notes?: string
  type?: Task['type']
  customTypeKey?: string | null
  inputs?: Record<string, unknown>
}

export interface StoragePort {
  // tasks
  createTask(input: CreateTaskInput): Task
  getTask(id: string): Task | null
  updateTask(id: string, patch: Partial<Task>): Task
  // working content
  getNotes(taskId: string): TaskNote | null
  saveNotes(note: Omit<TaskNote, 'updatedAt'>): TaskNote
  // pre-process outputs (the deposit carries the summary)
  getPreprocess(taskId: string): TaskPreprocess | null
  // type registry
  listTypes(): TaskTypeDef[]
  getType(key: string): TaskTypeDef | null
  // settings
  loadSettings(): Settings
  saveSettings(settings: Settings): void
  // the activity record (surfaced as ingest history in the Activity view)
  createActivity(input: ActivityRecordInput): IngestRecord
  updateActivity(id: string, patch: ActivityPatch): void
  listActivity(): IngestRecord[]
}
