import type { DatabaseSync } from 'node:sqlite'
import type { ActivityPatch, ActivityRecordInput, StoragePort } from '../../../core/ports/storage'
import type { IngestRecord, Settings, Task, TaskNote, TaskPreprocess, TaskTypeDef } from '../../../shared/types'
import {
  createIngest,
  createTask,
  getIngest,
  getNotes,
  getPreprocess,
  getTask,
  getType,
  listIngest,
  listTypes,
  loadSettings,
  saveNotes,
  saveSettings,
  updateIngest,
  updateTask
} from '../../db'

// The StoragePort implementation over the SQLite adapter. Mechanical by
// design: it adds no rules, so the behaviour the existing tests pin stays
// exactly where it was.

export function createSqliteStorage(db: DatabaseSync): StoragePort {
  return {
    createTask: (input) => createTask(db, input),
    getTask: (id: string): Task | null => getTask(db, id),
    updateTask: (id: string, patch: Partial<Task>): Task => updateTask(db, id, patch),

    getNotes: (taskId: string): TaskNote | null => getNotes(db, taskId),
    saveNotes: (note: Omit<TaskNote, 'updatedAt'>): TaskNote => saveNotes(db, note),
    getPreprocess: (taskId: string): TaskPreprocess | null => getPreprocess(db, taskId),

    listTypes: (): TaskTypeDef[] => listTypes(db),
    getType: (key: string): TaskTypeDef | null => getType(db, key),

    loadSettings: (): Settings => loadSettings(db),
    saveSettings: (settings: Settings): void => saveSettings(db, settings),

    createActivity: (input: ActivityRecordInput): IngestRecord =>
      createIngest(db, input.taskId, input.taskTitle, input.depositFiles),
    updateActivity: (id: string, patch: ActivityPatch): void => updateIngest(db, id, patch),
    listActivity: (): IngestRecord[] => listIngest(db)
  }
}

export { getIngest }
