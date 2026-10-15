import type { Family } from './family'
import type { TaskTypeDef } from '../../shared/types'
import { declaredWorkflow } from './taskType'

// Which editing surface a task opens, and how its Finish action reads.
//
// Feature 002 re-keyed this onto the Family (research D1, D3): a document-family
// Type surfaces the task's own note as the WORKING AREA — a writing space where
// the user puts their actual work. The Jira `source-panel` surface is deleted
// with the working-system engine (FR-016); the "source-panel" case no longer
// exists. A family-less Type (`plain` and its user-defined equivalents) keeps
// the ordinary notes surface: its note is additional information, not a draft.
//
// This stays one mapping in the domain rather than a ternary per component, so
// a new Family is one entry and no `=== 'jira'` hunt returns (Principle I).

// 'source-panel' retired with the Jira engine; the two remaining surfaces are
// the notes field and the document working area (a markdown writing space).
export const WORKING_AREAS = ['notes', 'markdown'] as const
export type WorkingArea = (typeof WORKING_AREAS)[number]

export function workingAreaFor(family: Family | null | undefined): WorkingArea {
  // The document family is the only family this feature lights up, and the
  // only one whose task carries a written draft (research D3). Everything
  // else — `plain`, and the not-yet-live working-system / coding families —
  // opens the ordinary notes field.
  return family === 'document' ? 'markdown' : 'notes'
}

/**
 * The label on the Finish button. Derived from the type's declared behaviour
 * so the button tells the user what will actually happen — "organize and file"
 * is only true for the organize behaviour.
 */
export function finishActionLabel(def: TaskTypeDef | null | undefined): string {
  const behaviour = def ? declaredWorkflow(def).finishBehaviour : null
  switch (behaviour) {
    case 'deposit-then-curate':
      return 'Finish → ingest to wiki'
    case 'polish-then-file':
      // Re-argued as the generic organize step (research D2): the button says
      // "organize and file", not the retired meeting-minutes framing.
      return 'Finish → organize and file'
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
