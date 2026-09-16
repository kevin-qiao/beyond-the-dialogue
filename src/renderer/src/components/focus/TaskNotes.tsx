import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { Task } from '../../../../shared/types'
import { effectiveType } from '../../lib/typeCatalog'
import { emptyContentWarning, finishActionLabel, workingAreaFor } from '../../../../core/domain/workingArea'
import { NotesEditor } from './NotesEditor'
import { ChatPanel } from './ChatPanel'
import { RemoteProposalBar } from './RemoteProposalBar'
import { useDialog } from '../ui/Dialog'

// The markdown / notes working area of the focus column (spec app-layout).
//
// Which surface a task gets is decided by `workingAreaFor(category)`; the
// Finish button reads from the type's DECLARED behaviour, so the label always
// describes what will actually happen — "ingest to wiki" is true for one
// behaviour out of four, and saying it for a meeting would be a lie.

/** The markdown editing surface: the editor's Write/Preview/Chat tabs over one
 *  body, plus Finish and any proposed remote change. */
function MarkdownArea({ task }: { task: Task }) {
  const { snapshot, saveNote, finishTask, notify } = useApp()
  const notes = snapshot?.notes[task.id]
  const def = effectiveType(task, snapshot?.taskTypes)
  const { confirm } = useDialog()

  const handleFinishClick = async () => {
    const hasContent = (notes?.content ?? '').trim().length > 0
    const warning = emptyContentWarning(def)
    if (!hasContent && warning) {
      const ok = await confirm({
        title: 'Finish with nothing written?',
        message: warning,
        confirmLabel: 'Finish anyway',
        danger: true
      })
      if (!ok) return
    }
    try {
      await finishTask(task.id)
    } catch (e: any) {
      notify(e?.message ?? 'Finish failed')
    }
  }

  // The behaviour decides whether finishing produces anything at all.
  const writes = def?.finishBehaviour !== 'complete-only'

  return (
    <div className="learning-area focus-notes">
      <section className="notes-section">
        <NotesEditor
          taskId={task.id}
          initial={notes?.content ?? ''}
          onSave={saveNote}
          // The chat is the editor's third tab rather than a fixed pane under
          // it, so the conversation and the note share the column's height
          // instead of splitting it.
          chat={<ChatPanel taskId={task.id} />}
        />
      </section>
      {!task.completed && writes && (
        <div className="finish-row">
          <button className="finish-btn" onClick={() => void handleFinishClick()}>
            {finishActionLabel(def)}
          </button>
        </div>
      )}
      {/* A proposed remote change appears under the Finish action, where the
          user is already working, and shows exactly what would be sent. */}
      <RemoteProposalBar />
    </div>
  )
}

/** The plain surface: a single textarea, no AI band content of its own. */
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
  const area = workingAreaFor(effectiveType(task, snapshot?.taskTypes).kind)
  return area === 'markdown' ? <MarkdownArea task={task} /> : <PlainArea task={task} />
}
