import { useApp } from '../../store'
import { useT } from '../../lib/useT'

// The confirmation affordance for a proposed remote change (FR-023, SC-005).
//
// A remote change is never made from a conversation. The assistant proposes,
// this bar shows the user exactly what would be sent, and the change happens
// only when they confirm THAT proposal. The exact payload is on screen, not
// paraphrased — "the assistant will update the issue" is not something a user
// can meaningfully agree to.

export function RemoteProposalBar() {
  const { proposals, confirmRemoteChange, dismissProposal } = useApp()
  const t = useT()
  if (proposals.length === 0) return null

  return (
    <section className="remote-proposals" aria-label={t('proposal.ariaLabel')}>
      {proposals.map((p) => (
        <div key={p.id} className="remote-proposal">
          <div className="remote-proposal-head">
            <strong>{t('proposal.heading')}</strong>
          </div>
          <div className="muted">{p.summary}</div>
          <details className="remote-proposal-detail">
            <summary>{t('proposal.exactly')}</summary>
            <pre className="remote-proposal-payload">{`${p.operation} → ${p.server} (${p.target})\n${p.payloadPreview}`}</pre>
          </details>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary-btn" onClick={() => void confirmRemoteChange(p.id)}>
              {t('proposal.confirm')}
            </button>
            <button className="secondary-btn" onClick={() => void dismissProposal(p.id)}>
              {t('proposal.discard')}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
