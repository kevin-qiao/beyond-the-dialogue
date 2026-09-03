import { useApp } from '../store'
import type { Task } from '../../../shared/types'
import { NotesEditor } from './NotesEditor'

// Working area of the focus column (spec app-layout): the notes surface for
// the selected task. Paper tasks get the markdown editor; plain tasks a plain
// textarea — both autosave through the existing saveNote path.
export function TaskNotes({ task }: { task: Task }) {
  const { snapshot, saveNote } = useApp()
  const notes = snapshot?.notes[task.id]

  if (task.type === 'paper_reading') {
    return (
      <section className="notes-section focus-notes">
        <NotesEditor taskId={task.id} initial={notes?.content ?? ''} onSave={saveNote} />
      </section>
    )
  }
  return (
    <div className="plain-notes focus-notes">
      <textarea value={notes?.content ?? ''} onChange={(e) => void saveNote(task.id, e.target.value)} placeholder="Add details…" rows={12} />
    </div>
  )
}
