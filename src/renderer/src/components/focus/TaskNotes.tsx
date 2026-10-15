import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { Task } from '../../../../shared/types'
import { effectiveType } from '../../lib/typeCatalog'
import { workingAreaFor } from '../../../../core/domain/workingArea'
import { NotesEditor } from './NotesEditor'
import { RemoteProposalBar } from './RemoteProposalBar'

// The markdown / notes working area of the focus column (spec app-layout).
//
// Which surface a task gets is decided by `workingAreaFor(family)` (research
// D3): for a document-family Type this IS the working area — the writing
// space where the user puts their own words over as many sittings as the work
// takes. The storage is unchanged (the task note with its vault mirror); only
// the meaning is new, and it arrives by declaration.
//
// The Finish action is NOT here: the task band owns it, because that is where
// the mode choice lives (D8) and where the refusal of a blank draft (US1-AC6,
// localized from the core) is reported. The draft autosaves on change
// (debounced, flushed on blur/unmount), so it survives reopens and restarts
// with no save button (FR-002).

/** The markdown working area: the editor's Write/Preview tabs over one body,
 *  plus any proposed remote change. The chat is not here — it lives in the
 *  band above (FocusColumn). */
function MarkdownArea({ task }: { task: Task }) {
  const { snapshot, saveNote } = useApp()
  const t = useT()
  const notes = snapshot?.notes[task.id]

  return (
    <div className="learning-area focus-notes">
      <section className="notes-section">
        {/* The document family's note IS the working area (D3): same storage,
            a new meaning — named so the user can see it. */}
        <div className="section-head">
          <h4>{t('focus.workingArea')}</h4>
        </div>
        <NotesEditor taskId={task.id} initial={notes?.content ?? ''} onSave={saveNote} />
      </section>
      {/* A proposed remote change appears under the working area, where the
          user is already working, and shows exactly what would be sent. */}
      <RemoteProposalBar />
    </div>
  )
}

/** The plain surface: a single textarea, no assistance of its own. */
function PlainArea({ task }: { task: Task }) {
  const { snapshot, saveNote } = useApp()
  const t = useT()
  const notes = snapshot?.notes[task.id]
  return (
    <div className="plain-notes focus-notes">
      <textarea
        value={notes?.content ?? ''}
        onChange={(e) => void saveNote(task.id, e.target.value)}
        placeholder={t('task.notes.placeholder')}
        rows={12}
      />
    </div>
  )
}

export function TaskNotes({ task }: { task: Task }) {
  const { snapshot } = useApp()
  const area = workingAreaFor(effectiveType(task, snapshot?.taskTypes).family)
  return area === 'markdown' ? <MarkdownArea task={task} /> : <PlainArea task={task} />
}
