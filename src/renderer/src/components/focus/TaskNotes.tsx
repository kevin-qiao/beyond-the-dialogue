import { useApp } from '../../store'
import type { Task } from '../../../../shared/types'
import { effectiveKind } from '../../lib/typeCatalog'
import { NotesEditor } from './NotesEditor'
import { ChatPanel } from './ChatPanel'

// Working area of the focus column (spec app-layout / learning-type):
// learning tasks get the live markdown editor (rendered preview + autosave)
// with the task-grounded chat panel below it; plain tasks get the plain
// textarea — both autosave through the existing saveNote path. (Jira tasks
// use JiraArea — see FocusColumn.)
export function TaskNotes({ task }: { task: Task }) {
  const { snapshot, saveNote } = useApp()
  const notes = snapshot?.notes[task.id]
  const kind = effectiveKind(task, snapshot?.taskTypes)

  if (kind === 'learning') {
    return (
      <div className="learning-area focus-notes">
        <section className="notes-section">
          <NotesEditor taskId={task.id} initial={notes?.content ?? ''} onSave={saveNote} />
        </section>
        <section className="learning-chat">
          <div className="section-head">
            <h4>Ask the agent</h4>
          </div>
          <ChatPanel taskId={task.id} label="Ask anything about what you're learning — the agent sees your target, working prompt, and current note." />
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
