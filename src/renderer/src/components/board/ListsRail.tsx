import { useApp } from '../../store'

// Lists rail — the first column of the board. v0.8.1 simplifies it to two
// first-class views at the same level: My Day (today's flagged tasks) and To
// Do (the backlog of open tasks). List management is no longer surfaced here;
// the agent-presence footer remains.
export function ListsRail() {
  const { snapshot, activeView, setActiveView, liveJobs, activity, ingestSteps, openDrawer } = useApp()

  // Agent presence line (spec agent-presence): idle / working (with live
  // step) / queued count; clicking opens the Activity drawer.
  const jobs = Object.values(liveJobs)
  const runningJob = jobs.find((j) => j.state === 'running')
  const runningIngest = (activity ?? []).find((r) => r.state === 'running')
  const queuedCount = jobs.filter((j) => j.state === 'queued').length + (activity ?? []).filter((r) => r.state === 'queued').length

  const allTasks = snapshot?.tasks ?? []
  const myDayCount = allTasks.filter((t) => t.inMyDay).length
  const todoCount = allTasks.filter((t) => !t.completed).length

  return (
    <nav className="sidebar lists-rail">
      <button
        className={`rail-item nav-item ${activeView === 'my-day' ? 'active' : ''}`}
        onClick={() => setActiveView('my-day')}
      >
        <span className="rail-ico">☀️</span>
        My Day
        <span className="rail-cnt">{myDayCount}</span>
      </button>

      <button
        className={`rail-item nav-item ${activeView === 'todo' ? 'active' : ''}`}
        onClick={() => setActiveView('todo')}
      >
        <span className="rail-ico">📋</span>
        To Do
        <span className="rail-cnt">{todoCount}</span>
      </button>

      <div className="sidebar-foot">
        <div className="ai-status" onClick={() => openDrawer('activity')} title="Agent status — open Activity">
          {runningJob ? (
            <span className="ai-working"><span className="presence-dot" />{runningJob.stepLabel ?? 'working…'}</span>
          ) : runningIngest ? (
            <span className="ai-working"><span className="presence-dot" />{ingestSteps[runningIngest.id] ?? 'ingesting…'}</span>
          ) : queuedCount > 0 ? (
            <span className="ai-queued"><span className="presence-dot" />{queuedCount} job{queuedCount > 1 ? 's' : ''} queued</span>
          ) : snapshot?.aiConfigured ? (
            <span className="ai-on"><span className="presence-dot" />AI ready — agent idle</span>
          ) : (
            <span className="ai-off"><span className="presence-dot" />AI not configured</span>
          )}
        </div>
      </div>
    </nav>
  )
}
