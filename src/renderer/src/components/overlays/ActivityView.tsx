import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { JobProgressEvent } from '../../../../shared/ipc'
import type { IngestRecord } from '../../../../shared/types'
import type { MessageKey, Translate } from '../../../../core/i18n'

function stateBadge(state: string): string {
  if (state === 'done') return 'ok'
  if (state === 'failed') return 'err'
  return 'running'
}

// Job and ingest states are rendered as words, so they are translated. The
// record's own words are used for anything unrecognised rather than hidden —
// an unknown state is a fact about the record, not a label we can invent.
const STATE_LABEL: Record<string, MessageKey> = {
  queued: 'job.state.queued',
  running: 'job.state.running',
  done: 'job.state.done',
  failed: 'job.state.failed'
}

const KIND_LABEL: Record<string, MessageKey> = {
  preprocess: 'job.kind.preprocess',
  suggestion: 'job.kind.suggestion',
  ingest: 'job.kind.ingest'
}

function stateText(t: Translate, state: string): string {
  const key = STATE_LABEL[state]
  return key ? t(key) : state
}

function JobRow({ job }: { job: JobProgressEvent }) {
  const t = useT()
  const kind = KIND_LABEL[job.kind]
  const title = kind ? t(kind) : job.kind
  return (
    <div className={`activity-row state-${job.state}`}>
      <div className="activity-head">
        <strong>{title}</strong>
        <span className={`badge ${stateBadge(job.state)}`}>{stateText(t, job.state)}</span>
      </div>
      {job.stepLabel && <div className="muted">{t('job.step', { label: job.stepLabel })}</div>}
      {job.state === 'queued' && job.error && <div className="muted">{t('job.autoRetryPending')}</div>}
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
  const t = useT()
  // A degraded finish (done, but the assistant step failed) is reported as a
  // warning rather than a failure: the user's content WAS filed, and saying
  // otherwise would be wrong. It is still never presented as a clean success.
  const degraded = rec.state === 'done' && !!rec.error
  return (
    <div className={`activity-row state-${rec.state}${degraded ? ' degraded' : ''}`}>
      <div className="activity-head">
        <strong>{rec.taskTitle}</strong>
        <span className={`badge ${stateBadge(rec.state)}`}>
          {degraded ? t('job.state.unpolished') : stateText(t, rec.state)}
        </span>
      </div>
      <div className="muted">{rec.createdAt ? new Date(rec.createdAt).toLocaleString() : ''}</div>
      {rec.state === 'running' && step && <div className="muted">{t('job.step', { label: step })}</div>}
      {rec.state === 'queued' && rec.error && (
        <div className="muted">{t('job.autoRetryAttempt', { n: rec.attempts })}</div>
      )}
      {rec.depositFiles.length > 0 && <div className="muted">{t('job.deposited', { files: rec.depositFiles.join(', ') })}</div>}
      {rec.touchedFiles.length > 0 && <div className="muted">{t('job.filesWritten', { files: rec.touchedFiles.join(', ') })}</div>}
      {rec.error && rec.state !== 'queued' && <div className={degraded ? 'muted' : 'error-text'}>{rec.error}</div>}
      {rec.state === 'failed' && (
        <button className="mini-btn" onClick={() => void retryIngest(rec.id)}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

export function ActivityView() {
  const { activity, liveJobs, ingestSteps } = useApp()
  const t = useT()
  // Live job rows stream in via ev:job-progress; ingestions via the ledger.
  const jobs = liveJobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'failed')

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('drawer.activity.title')}</h2>
        <span className="muted">{t('activity.sub')}</span>
      </div>
      {activity.length === 0 && jobs.length === 0 && <div className="empty-hint">{t('activity.empty')}</div>}
      {jobs.length > 0 && (
        <div className="activity-list">
          <div className="section-label">{t('activity.jobs')}</div>
          {jobs.map((j) => (
            <JobRow key={j.jobId} job={j} />
          ))}
        </div>
      )}
      {activity.length > 0 && (
        <div className="activity-list">
          <div className="section-label">{t('activity.finished')}</div>
          {activity.map((rec) => (
            <IngestRow key={rec.id} rec={rec} step={ingestSteps[rec.id] ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}
