import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../../../shared/types'
import { useApp } from '../../store'
import { useT } from '../../lib/useT'

// JIRA/Confluence working area (spec jira-confluence-type, design D4): the
// pasted source (read-only) and a comments area whose drafts persist locally
// with the task (inputs.comments). The chat grounded in the source moved to
// the band above (FocusColumn). v0.8 has no connector: there is deliberately
// no posting action, and the surfaces are labeled as drafts.
export function JiraArea({ task }: { task: Task }) {
  const { updateTask, notify } = useApp()
  const t = useT()
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
        notify(t('jira.draft.failed'))
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
          <h4>{isPage ? t('jira.source.page') : t('jira.source.issue')}</h4>
          <span className="muted">{t('jira.source.hint')}</span>
        </div>
        {sourceText ? (
          <pre className="source-text">{sourceText}</pre>
        ) : (
          <div className="empty-hint">{t('jira.source.empty')}</div>
        )}
      </section>
      <section className="jira-comments">
        <div className="section-head">
          <h4>{t('jira.drafts.title')}</h4>
          <span className="muted">{t('jira.drafts.hint')}</span>
        </div>
        <textarea
          value={comments}
          onChange={(e) => scheduleSave(e.target.value)}
          rows={5}
          placeholder={t('jira.drafts.placeholder')}
        />
      </section>
    </div>
  )
}
