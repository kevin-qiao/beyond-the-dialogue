import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { ChatPanel } from './ChatPanel'

// JIRA/Confluence working area (spec jira-confluence-type, design D4): the
// pasted source (read-only), a chat panel grounded in it, and a comments
// area whose drafts persist locally with the task (inputs.comments). v0.8 has
// no connector: there is deliberately no posting action, and the surfaces are
// labeled as drafts.
export function JiraArea({ task }: { task: Task }) {
  const { updateTask, notify } = useApp()
  const sourceText = typeof task.inputs.sourceText === 'string' ? task.inputs.sourceText : ''
  const isPage = task.inputs.sourceKind === 'page'
  const [comments, setComments] = useState(typeof task.inputs.comments === 'string' ? task.inputs.comments : '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)

  useEffect(() => {
    setComments(typeof task.inputs.comments === 'string' ? task.inputs.comments : '')
  }, [task.id])

  // Debounced autosave of the draft into the task's inputs (survives restart).
  const scheduleSave = (value: string) => {
    setComments(value)
    pendingRef.current = value
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (pendingRef.current === null) return
      void updateTask({ id: task.id, inputs: { ...task.inputs, comments: pendingRef.current } }).catch(() =>
        notify('Could not save the comment draft')
      )
      pendingRef.current = null
    }, 600)
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return (
    <div className="jira-area">
      <section className="jira-source">
        <div className="section-head">
          <h4>{isPage ? 'Confluence page content' : 'JIRA issue content'}</h4>
          <span className="muted">pasted source · read-only</span>
        </div>
        {sourceText ? <pre className="source-text">{sourceText}</pre> : <div className="empty-hint">No source content yet — paste the issue/page content in Details above.</div>}
      </section>
      <section className="jira-comments">
        <div className="section-head">
          <h4>Comment drafts</h4>
          <span className="muted">saved locally · nothing is posted in this version</span>
        </div>
        <textarea value={comments} onChange={(e) => scheduleSave(e.target.value)} rows={5} placeholder="Draft a comment for the issue/page…" />
      </section>
      <section className="jira-chat">
        <ChatPanel taskId={task.id} label="" />
      </section>
    </div>
  )
}
