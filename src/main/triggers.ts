import type { Settings, Task } from '../shared/types'
import { isConfigured } from './ai-config'

// Job trigger rules for the IPC handlers in index.ts. Kept pure and free of
// Electron/JobQueue imports so the decoupling semantics are unit-testable:
// analysis is a property of a paper task (starts on creation with a link),
// My Day is planning-only (never triggers analysis; suggestions still fire
// on first add).

export function shouldAutoAnalyze(task: Task | null, settings: Settings): boolean {
  if (!task) return false
  return task.type === 'paper_reading' && !!task.link && isConfigured(settings)
}

export function shouldSuggestOnMyDayAdd(before: Task | null, inMyDay: boolean): boolean {
  // Suggestions fire when the task is newly added to My Day (not on repeat
  // adds or removals).
  return inMyDay && !!before && !before.inMyDay
}
