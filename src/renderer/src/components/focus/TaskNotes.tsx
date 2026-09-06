import { useApp } from '../../store'
import type { Task } from '../../../../shared/types'
import { effectiveKind } from '../../lib/typeCatalog'
import { NotesEditor } from './NotesEditor'
import { ChatPanel } from './ChatPanel'
import { useDialog } from '../ui/Dialog'

// Working area of the focus column (spec app-layout / learning-type):
// learning tasks get the live markdown editor (rendered preview + autosave)
// with the ingest action below it and the task-grounded chat panel; plain
// tasks get the plain textarea — both autosave through the existing saveNote
// path. (Jira tasks use JiraArea — see FocusColumn.)
export function TaskNotes({ task }: { task: Task }) {
  const { snapshot, saveNote, finishTask, notify } = useApp()
  const notes = snapshot?.notes[task.id]
  const kind = effectiveKind(task, snapshot?.taskTypes)
  const { confirm } = useDialog()

  const handleFinishClick = async () => {
    const hasNote = (notes?.content ?? '').trim().length > 0
    if (!hasNote) {
      const ok = await confirm({
        title: 'Finish without notes?',
        message: 'Your learning note is empty. Nothing meaningful will be ingested to your wiki if you finish now.',
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

  if (kind === 'learning') {
    return (
      <div className="learning-area focus-notes">
        <section className="notes-section">
          <NotesEditor taskId={task.id} initial={notes?.content ?? ''} onSave={saveNote} />
        </section>
        {!task.completed && (
          <div className="finish-row">
            <button className="finish-btn" onClick={() => void handleFinishClick()}>
              Finish → ingest to wiki
            </button>
          </div>
        )}
        <section className="learning-chat">
          <ChatPanel taskId={task.id} label="" />
        </section>
      </div>
    )
  }
  return (
    <div className="plain-notes focus-notes">
      <textarea value={notes?.content ?? ''} onChange={(e) => void saveNote(task.id, e.target.value)} placeholder="Add details…" rows={12} />
    </div>
  )
}
