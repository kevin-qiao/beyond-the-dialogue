import type { Settings, Task } from '../../shared/types'
import type { StoragePort } from '../ports/storage'
import type { BackgroundWork } from './taskService'
import { effectiveCategory } from '../domain/taskType'
import { hasPreprocess } from '../domain/preprocess'
import { LocalizedError, type IssueList } from '../i18n/issues'
import { isConfigured } from '../domain/config'

// Pre-process use case: decide whether a task can be pre-processed, and say
// what the caller should do about it.
//
// These were three guards inline in an IPC handler, which meant the rules
// could only be exercised by launching Electron. The plan is explicit that the
// composition root owns no workflow logic; this is the last of it.

/**
 * Raised when a pre-process must not be run. Distinct from a job failure: the
 * user asked for something the task's own configuration cannot do, so it is
 * reported immediately rather than queued and failed later.
 */
/** A refusal the user must read. Carries codes; the transport phrases them. */
export class PreprocessRefused extends LocalizedError {
  constructor(issues: IssueList) {
    super(issues)
    this.name = 'PreprocessRefused'
  }
}

export interface PreprocessOutcome {
  task: Task
  /** Jobs the caller should enqueue. */
  enqueue: BackgroundWork[]
}

/**
 * Queue a pre-process for a task the user explicitly asked to re-run.
 *
 * A category with no pre-process is refused by asking the registry, not by
 * comparing against `plain`: the registry is what decides which categories
 * pre-process, so a future category is handled without editing this.
 */
export function runPreprocess(storage: StoragePort, id: string, settings: Settings): PreprocessOutcome {
  const task = storage.getTask(id)
  if (!task) throw new Error('task not found')

  const category = effectiveCategory(storage.listTypes(), task)
  if (!hasPreprocess(category)) {
    throw new PreprocessRefused([{ key: 'preprocess.noPreprocess' }])
  }
  if (!isConfigured(settings)) {
    throw new PreprocessRefused([{ key: 'error.aiNotConfigured' }])
  }

  const queued = storage.updateTask(task.id, { preprocessStatus: 'queued', preprocessError: null })
  return { task: queued, enqueue: ['preprocess'] }
}
