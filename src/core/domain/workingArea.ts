import type { TaskTypeDef } from '../../shared/types'
import type { TaskCategory } from './categories'
import { declaredWorkflow } from './taskType'

// Which editing surface a task opens, and how its Finish action reads.
//
// Per-type working-area declaration is out of scope for this version (spec
// scope boundary): the category still selects the surface. That selection
// lives here, in one place, rather than as a ternary in a component — so
// adding a category is an entry in one mapping instead of a hunt for
// `=== 'jira'` across the renderer.

export const WORKING_AREAS = ['notes', 'markdown', 'source-panel'] as const
export type WorkingArea = (typeof WORKING_AREAS)[number]

export function workingAreaFor(category: TaskCategory): WorkingArea {
  switch (category) {
    case 'jira':
      return 'source-panel'
    case 'learning':
    case 'meeting':
      return 'markdown'
    case 'plain':
      return 'notes'
  }
}

/**
 * The label on the Finish button. Derived from the type's declared behaviour
 * so the button tells the user what will actually happen — "ingest to wiki" is
 * only true for one of the four behaviours.
 */
export function finishActionLabel(def: TaskTypeDef | null | undefined): string {
  const behaviour = def ? declaredWorkflow(def).finishBehaviour : null
  switch (behaviour) {
    case 'deposit-then-curate':
      return 'Finish → ingest to wiki'
    case 'polish-then-file':
      return 'Finish → polish and file'
    case 'file-as-is':
      return 'Finish → file as written'
    case 'complete-only':
    case null:
    default:
      return 'Finish'
  }
}

/** The warning shown when finishing with nothing written, per behaviour. */
export function emptyContentWarning(def: TaskTypeDef | null | undefined): string | null {
  const behaviour = def ? declaredWorkflow(def).finishBehaviour : null
  if (behaviour === 'deposit-then-curate') {
    return 'Your note is empty. Nothing meaningful will be ingested to your wiki if you finish now.'
  }
  if (behaviour === 'polish-then-file' || behaviour === 'file-as-is') {
    return 'Nothing has been written yet, so the file would be empty.'
  }
  return null
}
