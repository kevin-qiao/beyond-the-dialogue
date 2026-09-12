import type { Settings, Task } from '../../shared/types'
import type { StoragePort } from '../ports/storage'
import type { BackgroundWork } from './taskService'
import { effectiveCategory } from '../domain/taskType'
import { hasPreprocess } from '../domain/preprocess'
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
export class PreprocessRefused extends Error {
  constructor(message: string) {
    super(message)
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
    throw new PreprocessRefused('this task type has no pre-process')
  }
  if (!isConfigured(settings)) {
    throw new PreprocessRefused(
      'AI not configured: open Settings to configure a provider, model and API key'
    )
  }

  const queued = storage.updateTask(task.id, { preprocessStatus: 'queued', preprocessError: null })
  return { task: queued, enqueue: ['preprocess'] }
}
