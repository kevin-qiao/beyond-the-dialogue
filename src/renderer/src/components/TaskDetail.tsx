import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../../shared/types'
import { useApp } from '../store'
import { NotesEditor } from './NotesEditor'
import { useDialog } from './Dialog'

export function TaskDetail({ task }: { task: Task }) {
  const { snapshot, toggleTask, setMyDay, deleteTask, updateTask, saveNote, requestReanalysis, attachPdf, resolveMismatch, notify } =
    useApp()
  const analysis = snapshot?.analyses[task.id]
  const notes = snapshot?.notes[task.id]
  const [pdfPickerOpen, setPdfPickerOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const { confirm, prompt, dialog } = useDialog()

  const handleDeleteClick = async () => {
    const ok = await confirm({
      title: 'Delete task',
      message: `Delete "${task.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) void deleteTask(task.id)
  }

  const handleFinishClick = async () => {
    const hasNote = (notes?.content ?? '').trim().length > 0
    if (!hasNote) {
      const ok = await confirm({
        title: 'Finish without notes?',
        message: 'Your reading note is empty. Nothing will be ingested to your wiki if you finish now.',
        confirmLabel: 'Finish anyway',
        danger: true
      })
      if (!ok) return
    }
    void handleFinish()
  }

  const handleCorrectLink = async () => {
    const newLink = await prompt({
      title: 'Correct link',
      message: 'Enter the correct paper link (arXiv / DOI / publisher URL):',
      placeholder: 'https://arxiv.org/abs/…'
    })
    if (newLink) {
      void updateTask(task.id, { link: newLink })
      void resolveMismatch(task.id, 'correct')
    }
  }

  const isPaper = task.type === 'paper_reading'

  const handleFinish = async () => {
    await window.api.finishTask({ id: task.id })
  }

  const runAnalysis = () => {
    if (!snapshot?.aiConfigured) {
      notify('AI not configured — open Settings to enable analysis')
      return
    }
    void requestReanalysis(task.id)
  }

  const attachPdfFromFile = async () => {
    const fp = await window.api.choosePdf()
    if (fp) {
      await attachPdf(task.id, fp)
      await requestReanalysis(task.id)
      setPdfPickerOpen(false)
    }
  }

  return (
    <div className="detail">
      <div className="detail-head">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditingTitle(false)
              if (titleDraft !== task.title) void updateTask(task.id, { title: titleDraft })
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h3 onDoubleClick={() => setEditingTitle(true)}>{task.title}</h3>
        )}
        <div className="detail-actions">
          <button className={`day-toggle ${task.inMyDay ? 'in' : ''}`} onClick={() => void setMyDay(task.id, !task.inMyDay)}>
            {task.inMyDay ? '★ In My Day' : '☆ Add to My Day'}
          </button>
          <button className="secondary-btn" onClick={() => void toggleTask(task.id)}>
            {task.completed ? 'Reopen' : 'Complete'}
          </button>
          <button className="danger-btn" onClick={() => void handleDeleteClick()}>
            Delete
          </button>
        </div>
      </div>

      {task.completed && <div className="completed-banner">Completed {task.completedAt ? new Date(task.completedAt).toLocaleString() : ''}</div>}

      {isPaper && (
        <>
          <div className="paper-info">
            <div className="muted">Link: {task.link ?? '(none)'}</div>
            {task.paperTitle && task.paperTitle !== task.title && <div>Resolved title: {task.paperTitle}</div>}
            {task.analysisLevel && <span className="badge">{task.analysisLevel} analysis</span>}
            {task.analysisStatus === 'abstract_only' && <span className="badge warn">abstract-only</span>}
          </div>

          {task.mismatchState === 'warning' && (
            <div className="warning-box">
              <p>
                The resolved paper title looks different from your task name. Verify the link points to the right paper before
                relying on the results.
              </p>
              <div className="row">
                <button className="primary-btn" onClick={() => void resolveMismatch(task.id, 'confirm')}>
                  It's correct
                </button>
                <button className="secondary-btn" onClick={() => void handleCorrectLink()}>
                  Correct link
                </button>
                <button className="secondary-btn" onClick={() => setPdfPickerOpen(true)}>
                  Attach PDF instead
                </button>
              </div>
            </div>
          )}

          <section className="analysis-section">
            <div className="section-head">
              <h4>Analysis</h4>
              <div className="row">
                {task.analysisStatus === 'queued' || task.analysisStatus === 'running' ? (
                  <span className="badge running">running…</span>
                ) : (
                  <>
                    <button className="mini-btn" onClick={runAnalysis}>
                      Re-analyze
                    </button>
                    <button className="mini-btn" onClick={() => setPdfPickerOpen(true)}>
                      Attach PDF
                    </button>
                  </>
                )}
              </div>
            </div>
            {task.analysisStatus === 'failed' && (
              <div className="warning-box">
                <p>Analysis failed: {task.analysisError ?? 'unknown error'}</p>
                <button className="primary-btn" onClick={runAnalysis}>
                  Retry
                </button>
              </div>
            )}
            {!analysis && task.analysisStatus !== 'queued' && task.analysisStatus !== 'running' && (
              <div className="empty-hint">
                {task.analysisStatus === 'failed'
                  ? 'Analysis failed.'
                  : 'No analysis yet. Add this task to My Day to start analysis, or click Re-analyze.'}
              </div>
            )}
            {analysis && (
              <div className="analysis-cards">
                <div className="card">
                  <h5>TLDR</h5>
                  <p>{analysis.tldr}</p>
                </div>
                <div className="card">
                  <h5>Contributions</h5>
                  <ul>
                    {analysis.contributions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h5>Method</h5>
                  <p>{analysis.method}</p>
                </div>
                <div className="card">
                  <h5>Results</h5>
                  <p>{analysis.results}</p>
                </div>
                {analysis.prerequisites.length > 0 && (
                  <div className="card">
                    <h5>Prerequisites</h5>
                    <ul>
                      {analysis.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="card">
                  <h5>Reading suggestions</h5>
                  {analysis.suggestions.map((s) => (
                    <div key={s.id} className="suggestion-card">
                      <strong>{s.title}</strong>
                      <p>{s.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="notes-section">
            <div className="section-head">
              <h4>Reading notes</h4>
              <span className="muted">Markdown, autosaved</span>
            </div>
            <NotesEditor taskId={task.id} initial={notes?.content ?? ''} onSave={saveNote} />
          </section>

          {!task.completed && (
            <div className="finish-row">
              <button className="finish-btn" onClick={() => void handleFinishClick()}>
                Finish → ingest to wiki
              </button>
            </div>
          )}
        </>
      )}

      {!isPaper && (
        <div className="plain-notes">
          <h4>Notes</h4>
          <textarea
            value={notes?.content ?? ''}
            onChange={(e) => void saveNote(task.id, e.target.value)}
            placeholder="Add details…"
            rows={8}
          />
        </div>
      )}

      {pdfPickerOpen && (
        <div className="modal-backdrop" onClick={() => setPdfPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Attach PDF</h3>
            <p className="muted">Attach a local PDF to use as the full-text source. Analysis will be re-run using it.</p>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setPdfPickerOpen(false)}>
                Cancel
              </button>
              <button className="primary-btn" onClick={() => void attachPdfFromFile()}>
                Choose file…
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  )
}
