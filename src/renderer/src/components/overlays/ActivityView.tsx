import { useApp } from '../../store'
import type { JobProgressEvent } from '../../../../shared/ipc'
import type { IngestRecord } from '../../../../shared/types'

function stateBadge(state: string): string {
  if (state === 'done') return 'ok'
  if (state === 'failed') return 'err'
  return 'running'
}

function JobRow({ job }: { job: JobProgressEvent }) {
  const title = job.kind === 'preprocess' ? 'Pre-process' : job.kind === 'suggestion' ? 'Suggestions' : job.kind
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

// A finish of any writing behaviour lands here: a wiki ingestion, a polished
// meeting's minutes filed to a folder, a plain file written as-is. The record
// shape is the same because the question it answers is the same — what did
// this finish actually write, and did anything go wrong?
function IngestRow({ rec, step }: { rec: IngestRecord; step: string | null }) {
  const { retryIngest } = useApp()
  // A degraded finish (done, but the assistant step failed) is reported as a
  // warning rather than a failure: the user's content WAS filed, and saying
  // otherwise would be wrong. It is still never presented as a clean success.
  const degraded = rec.state === 'done' && !!rec.error
  return (
    <div className={`activity-row state-${rec.state}${degraded ? ' degraded' : ''}`}>
      <div className="activity-head">
        <strong>{rec.taskTitle}</strong>
        <span className={`badge ${stateBadge(rec.state)}`}>{degraded ? 'done — unpolished' : rec.state}</span>
      </div>
      <div className="muted">{rec.createdAt ? new Date(rec.createdAt).toLocaleString() : ''}</div>
      {rec.state === 'running' && step && <div className="muted">step: {step}</div>}
      {rec.state === 'queued' && rec.error && <div className="muted">auto-retry (attempt {rec.attempts}/3)</div>}
      {rec.depositFiles.length > 0 && <div className="muted">Deposited: {rec.depositFiles.join(', ')}</div>}
      {rec.touchedFiles.length > 0 && <div className="muted">Files written: {rec.touchedFiles.join(', ')}</div>}
      {rec.error && rec.state !== 'queued' && <div className={degraded ? 'muted' : 'error-text'}>{rec.error}</div>}
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
        <div className="empty-hint">Nothing running yet. Add a typed task to My Day to pre-process it, or finish one to file what you wrote.</div>
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
          <div className="section-label">Finished work</div>
          {activity.map((rec) => (
            <IngestRow key={rec.id} rec={rec} step={ingestSteps[rec.id] ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}
