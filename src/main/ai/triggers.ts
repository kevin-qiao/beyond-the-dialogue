import type { Settings, Task, TaskKind } from '../../shared/types'
import { isConfigured } from './ai-config'

// Job trigger rules for the IPC handlers in index.ts. Kept pure and free of
// Electron/JobQueue imports so the decoupling semantics are unit-testable:
// My Day first-add fires the suggestion chips (all types) and the kind's
// pre-process (learning/jira only, AI configured); plain tasks never
// pre-process.

export function shouldSuggestOnMyDayAdd(before: Task | null, inMyDay: boolean): boolean {
  // Suggestions fire when the task is newly added to My Day (not on repeat
  // adds or removals).
  return inMyDay && !!before && !before.inMyDay
}

// Pre-process fires on first add to My Day for AI-kinded types when the AI
// is configured (spec task-types: per-type AI pre-processing).
export function shouldPreprocessOnAdd(before: Task | null, inMyDay: boolean, kind: TaskKind, settings: Settings): boolean {
  return shouldSuggestOnMyDayAdd(before, inMyDay) && kind !== 'plain' && isConfigured(settings)
}

// Re-run when a task's relevant inputs change while it sits in My Day
// (design D3 hash gate): `consumedHash` is what the last finished run
// recorded (from task_preprocess), newHash the inputs as they'd be after the
// edit. A run must not already be in flight; ready/failed states both allow
// a re-run.
export function shouldPreprocessOnEdit(
  task: Task,
  kind: TaskKind,
  settings: Settings,
  newHash: string,
  consumedHash: string
): boolean {
  if (kind === 'plain' || !isConfigured(settings)) return false
  if (!task.inMyDay || task.completed) return false
  if (task.preprocessStatus === 'queued' || task.preprocessStatus === 'running') return false
  return newHash !== consumedHash
}
