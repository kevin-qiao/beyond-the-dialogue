import { useApp } from '../store'

export function ActivityView() {
  const { activity, retryIngest } = useApp()

  return (
    <div className="view">
      <div className="view-head">
        <h2>Activity</h2>
        <span className="muted">Wiki ingestion history</span>
      </div>
      {activity.length === 0 && <div className="empty-hint">No ingestions yet. Finish a paper-reading task to see activity here.</div>}
      <div className="activity-list">
        {activity.map((rec) => (
          <div key={rec.id} className={`activity-row state-${rec.state}`}>
            <div className="activity-head">
              <strong>{rec.taskTitle}</strong>
              <span className={`badge ${rec.state === 'done' ? 'ok' : rec.state === 'failed' ? 'err' : 'running'}`}>{rec.state}</span>
            </div>
            <div className="muted">{rec.createdAt ? new Date(rec.createdAt).toLocaleString() : ''}</div>
            {rec.depositFiles.length > 0 && (
              <div className="muted">Deposited: {rec.depositFiles.join(', ')}</div>
            )}
            {rec.touchedFiles.length > 0 && (
              <div className="muted">Touched: {rec.touchedFiles.join(', ')}</div>
            )}
            {rec.error && <div className="error-text">{rec.error}</div>}
            {rec.state === 'failed' && (
              <button className="mini-btn" onClick={() => void retryIngest(rec.id)}>
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
