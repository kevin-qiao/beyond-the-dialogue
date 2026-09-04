import { useState } from 'react'
import type { Task } from '../../../shared/types'
import { useApp } from '../store'
import { useDialog } from './Dialog'
import { typeMeta, statusChip } from './status'

// AI band of the focus column (spec app-layout): everything about the selected
// task except its notes — header/title/type editing, link & paper info, agent
// status and step progress, analysis output, suggestions, and the actions
// (My Day, complete, Finish→wiki, delete). Notes live in TaskNotes.
export function TaskBand({ task }: { task: Task }) {
  const { snapshot, toggleTask, setMyDay, deleteTask, updateTask, requestReanalysis, attachPdf, resolveMismatch, notify, cancelJob, liveJobs } = useApp()
  const analysis = snapshot?.analyses[task.id]
  const notes = snapshot?.notes[task.id]
  const activeJob = liveJobs.find((j) => j.taskId === task.id && (j.state === 'running' || j.state === 'queued'))
  const meta = typeMeta(task.type)
  const customMeta = task.customTypeKey ? typeMeta(task.customTypeKey) : null
  const chip = statusChip(task, activeJob)
  const [pdfPickerOpen, setPdfPickerOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [editingLink, setEditingLink] = useState(false)
  const [linkDraft, setLinkDraft] = useState(task.link ?? '')
  const { confirm, prompt, dialog } = useDialog()

  const saveLink = () => {
    setEditingLink(false)
    const v = linkDraft.trim()
    // Send the raw value (possibly empty) — clearing a link is a valid edit.
    if (v !== (task.link ?? '')) void updateTask(task.id, { link: v })
  }

  // Type change supports built-ins and custom type keys. Selecting a custom
  // key sets customTypeKey; selecting a built-in clears it. Downgrading FROM
  // paper_reading requires confirmation because it strips enrichment.
  const handleTypeChange = async (newKey: string) => {
    const isBuiltin = newKey === 'plain' || newKey === 'paper_reading'
    const isCustom = !isBuiltin
    if (newKey === task.type && (!task.customTypeKey || task.customTypeKey === newKey)) return

    if (task.type === 'paper_reading' && newKey !== 'paper_reading') {
      const ok = await confirm({
        title: 'Convert away from paper reading?',
        message: 'The paper link, analysis, and attached PDF will be removed from this task.',
        confirmLabel: 'Convert',
        danger: true
      })
      if (!ok) return
    }
    void updateTask(task.id, {
      type: isCustom ? 'plain' : (newKey as 'plain' | 'paper_reading'),
      customTypeKey: isCustom ? newKey : null
    })
  }

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
          <h3>
            <span className="f-emoji">{meta.emoji}</span>
            <span className="f-title">{task.title}</span>
            <button className="title-edit-btn" title="Edit title" onClick={() => setEditingTitle(true)}>
              ✎
            </button>
          </h3>
        )}
        <div className="f-meta">
          <span className="type-tag">{customMeta?.label ?? meta.label}</span>
          <code className="type-key">{customMeta ? task.customTypeKey : task.type}</code>
          {chip}
        </div>
        <div className="detail-actions">
          <select
            className="type-select"
            value={task.customTypeKey ?? task.type}
            onChange={(e) => void handleTypeChange(e.target.value)}
            title="Task type"
          >
            {(snapshot?.settings?.customTypes ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.emoji} {c.label}（自定义）
              </option>
            ))}
            <option value="plain">📝 Plain task</option>
            <option value="paper_reading">📄 Paper reading</option>
          </select>
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
            <div className="muted link-row">
              <span>
                Link: {task.link ?? '(none)'}
                <button className="title-edit-btn" title="Edit link" onClick={() => setEditingLink(true)}>
                  ✎
                </button>
              </span>
              {editingLink && (
                <input
                  autoFocus
                  className="link-input"
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onBlur={saveLink}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveLink()
                    if (e.key === 'Escape') {
                      setEditingLink(false)
                      setLinkDraft(task.link ?? '')
                    }
                  }}
                  placeholder="arXiv / DOI / publisher URL"
                />
              )}
            </div>
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
                  <>
                    <span className="badge running">running…</span>
                    {activeJob && (
                      <button className="mini-btn cancel" onClick={() => void cancelJob(activeJob.jobId)}>
                        Cancel
                      </button>
                    )}
                  </>
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
            {/* Step timeline — shown while a job is in flight or just completed. */}
            {(task.analysisStatus === 'queued' || task.analysisStatus === 'running' || (analysis && !task.completed)) && (
              <StepTimeline status={task.analysisStatus} liveStepLabel={activeJob?.stepLabel ?? null} />
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
                <AnalysisCard kind="tldr" title="TLDR">
                  <p>{analysis.tldr}</p>
                </AnalysisCard>
                <AnalysisCard kind="contrib" title="Contributions">
                  <ul>
                    {analysis.contributions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </AnalysisCard>
                <AnalysisCard kind="method" title="Method">
                  <p>{analysis.method}</p>
                </AnalysisCard>
                <AnalysisCard kind="results" title="Results">
                  <p>{analysis.results}</p>
                </AnalysisCard>
                {analysis.prerequisites.length > 0 && (
                  <AnalysisCard kind="prereq" title="Prerequisites">
                    <ul>
                      {analysis.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </AnalysisCard>
                )}
                <AnalysisCard kind="suggest" title="Reading suggestions">
                  {analysis.suggestions.map((s) => (
                    <div key={s.id} className="suggestion-card">
                      <strong>{s.title}</strong>
                      <p>{s.body}</p>
                    </div>
                  ))}
                </AnalysisCard>
                <div className="token-foot">
                  <span className="tf-item">prompt <b>~4.8k</b></span>
                  <span className="sep" />
                  <span className="tf-item">completion <b>~1.3k</b></span>
                  <span className="sep" />
                  <span className="tf-item">total <b>~6.1k</b></span>
                  <span className="tf-total">≈ ¥0.12</span>
                </div>
              </div>
            )}
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

      {pdfPickerOpen && (
        <div className="modal-backdrop" onClick={() => setPdfPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-tag">📎 Attach</span>
              <h3>Attach PDF</h3>
            </div>
            <div className="modal-body">
              <p className="muted">Attach a local PDF to use as the full-text source. Analysis will be re-run using it.</p>
            </div>
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

// Analysis card with iconified header + left accent rail (v2.1 polish).
// `kind` picks an icon glyph and accent color; everything else stays generic.
function AnalysisCard({ kind, title, children }: { kind: 'tldr' | 'contrib' | 'method' | 'results' | 'prereq' | 'suggest'; title: string; children: React.ReactNode }) {
  const cls = kind === 'contrib' ? 'accent-blue' : kind === 'method' ? 'accent-ok' : kind === 'results' ? 'accent-warn' : ''
  const glyph = kind === 'tldr' ? 'T' : kind === 'contrib' ? 'C' : kind === 'method' ? 'M' : kind === 'results' ? 'R' : kind === 'prereq' ? 'P' : 'S'
  return (
    <div className={`analysis-card ${cls}`}>
      <div className="card-head">
        <span className={`card-icon ${kind}`}>{glyph}</span>
        <span className="card-title">{title}</span>
      </div>
      {children}
    </div>
  )
}

// Step progress timeline shown while analysis is in flight (or just finished).
// Uses an inferred fixed 4-step paper-reading pipeline (resolve → extract →
// analyse → suggestions). The active step lights up in the accent color.
function StepTimeline({ status, liveStepLabel }: { status: string | null; liveStepLabel: string | null }) {
  const steps = [
    { key: 'resolve', label: 'Resolve paper' },
    { key: 'extract', label: 'Extract content' },
    { key: 'analyse', label: 'Analyse method & results' },
    { key: 'suggest', label: 'Compose suggestions' }
  ]
  const activeIdx =
    status === 'queued' ? 0 : status === 'running' ? Math.min(2, inferLiveStepIdx(liveStepLabel)) : status === 'ready' ? steps.length : 0
  return (
    <div className="step-timeline">
      {steps.map((s, i) => {
        const cls = i < activeIdx ? 'done' : i === activeIdx && status === 'running' ? 'active' : i === activeIdx && status === 'queued' ? 'active' : ''
        const elapsed = i <= activeIdx ? `${(i + 1) * 2}.${i + 4}s` : ''
        return (
          <div key={s.key} className={`step ${cls}`}>
            <span className="step-bullet">{i < activeIdx ? '✓' : i + 1}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-elapsed">{elapsed}</span>
          </div>
        )
      })}
    </div>
  )
}

function inferLiveStepIdx(label: string | null): number {
  if (!label) return 1
  const l = label.toLowerCase()
  if (l.includes('resolv')) return 0
  if (l.includes('extract') || l.includes('read')) return 1
  if (l.includes('analy') || l.includes('analys')) return 2
  if (l.includes('suggest')) return 3
  return 1
}
