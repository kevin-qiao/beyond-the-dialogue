import { useApp } from '../store'
import type { JobProgressEvent } from '../../../shared/ipc'
import type { IngestRecord } from '../../../shared/types'

function stateBadge(state: string): string {
  if (state === 'done') return 'ok'
  if (state === 'failed') return 'err'
  return 'running'
}

function JobRow({ job }: { job: JobProgressEvent }) {
  const title = job.kind === 'analysis' ? 'Paper analysis' : job.kind === 'suggestion' ? 'Suggestions' : job.kind
  return (
    <div className={`activity-row state-${job.state}`}>
      <div className="activity-head">
        <strong>{title}</strong>
        <span className={`badge ${stateBadge(job.state)}`}>{job.state}</span>
      </div>
      {job.stepLabel && <div className="muted">step: {job.stepLabel}</div>}
      {job.state === 'queued' && job.error && <div className="muted">auto-retry pending</div>}
      {job.state === 'failed' && job.error && <div className="error-text">{job.error}</div>}
    </div>
  )
}

function IngestRow({ rec, step }: { rec: IngestRecord; step: string | null }) {
  const { retryIngest } = useApp()
  return (
    <div className={`activity-row state-${rec.state}`}>
      <div className="activity-head">
        <strong>{rec.taskTitle}</strong>
        <span className={`badge ${stateBadge(rec.state)}`}>{rec.state}</span>
      </div>
      <div className="muted">{rec.createdAt ? new Date(rec.createdAt).toLocaleString() : ''}</div>
      {rec.state === 'running' && step && <div className="muted">step: {step}</div>}
      {rec.state === 'queued' && rec.error && <div className="muted">auto-retry (attempt {rec.attempts}/3)</div>}
      {rec.depositFiles.length > 0 && <div className="muted">Deposited: {rec.depositFiles.join(', ')}</div>}
      {rec.touchedFiles.length > 0 && <div className="muted">Touched: {rec.touchedFiles.join(', ')}</div>}
      {rec.error && rec.state !== 'queued' && <div className="error-text">{rec.error}</div>}
      {rec.state === 'failed' && (
        <button className="mini-btn" onClick={() => void retryIngest(rec.id)}>
          Retry
        </button>
      )}
    </div>
  )
}

export function ActivityView() {
  const { activity, liveJobs, ingestSteps } = useApp()
  // Live job rows stream in via ev:job-progress; ingestions via the ledger.
  const jobs = liveJobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'failed')

  return (
    <div className="view">
      <div className="view-head">
        <h2>Activity</h2>
        <span className="muted">Agent work — live</span>
      </div>
      {activity.length === 0 && jobs.length === 0 && (
        <div className="empty-hint">Nothing running yet. Add a paper task to analyze it, or finish one to ingest it into your wiki.</div>
      )}
      {jobs.length > 0 && (
        <div className="activity-list">
          <div className="section-label">Running &amp; recent jobs</div>
          {jobs.map((j) => (
            <JobRow key={j.jobId} job={j} />
          ))}
        </div>
      )}
      {activity.length > 0 && (
        <div className="activity-list">
          <div className="section-label">Wiki ingestions</div>
          {activity.map((rec) => (
            <IngestRow key={rec.id} rec={rec} step={ingestSteps[rec.id] ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}
