import type { PluginGrant, Task, TaskTypeDef } from '../../shared/types'
import { NO_GRANT, hasAnyGrant } from '../../shared/types'
import type { SessionPurpose } from '../ports/agent'

// Grant resolution, the egress boundary, and the propose/confirm split
// (contracts/plugin-grants.md).
//
// This module concentrates the highest-risk behaviour in the feature: it is
// where the application deliberately opens an agent session to systems outside
// the machine. Two guarantees are architectural rather than conventional:
//
//   1. A confined operation gets NO grant, whatever the type declares.
//   2. A remote change is unreachable from the model's tool surface; the model
//      can only propose, and the application performs the change after a
//      per-change confirmation.
//
// Both are structural so they hold even when a type is misconfigured or a
// future caller is careless.

/**
 * The grant a run may use. `confined` is a property of the CALL SITE, not of
 * the caller's intent — which is the entire point of resolving it here.
 */
export function resolveGrant(req: { purpose: SessionPurpose; typeDef?: TaskTypeDef | null }): PluginGrant {
  if (req.purpose === 'confined') return NO_GRANT
  return req.typeDef?.grants ?? NO_GRANT
}

// ---- the egress boundary (FR-029, SC-010) ----

export interface ContextPart {
  label: string
  value: string
}

/**
 * What a session may see.
 *
 * Enforced at context CONSTRUCTION, not at the tool boundary. Transmitting is
 * determined by what the model can see, so filtering at the call site is too
 * late — the content is already in the prompt. A granted session therefore
 * sees less, deliberately: only the task's declared inputs and the user's
 * request. The user chose to let the session out, so it sees less of their
 * private material.
 */
export function buildSessionContext(args: {
  task: Pick<Task, 'title' | 'notes' | 'inputs'>
  typeDef: TaskTypeDef | null | undefined
  purpose: SessionPurpose
  /** Everything the ungranted path would include: notes, minutes, wiki, history. */
  fullContext: () => string | undefined
}): string | undefined {
  if (args.purpose === 'confined') return args.fullContext()
  if (!hasAnyGrant(args.typeDef?.grants)) return args.fullContext()
  return declaredInputsOnly(args.task)
}

/**
 * Only the task's declared inputs and its own description. Notes, minutes,
 * drafts, the note store, the wiki, and other tasks are excluded.
 */
export function declaredInputsOnly(task: Pick<Task, 'title' | 'notes' | 'inputs'>): string {
  const lines = [`Task: ${task.title}`]
  if (task.notes) lines.push(`Description: ${task.notes}`)
  for (const [key, value] of Object.entries(task.inputs ?? {})) {
    if (typeof value === 'string' && value.trim()) lines.push(`${key}: ${value}`)
  }
  return lines.join('\n')
}

// ---- remote changes: propose, then confirm (FR-022, FR-023, SC-005) ----

export interface ProposedRemoteChange {
  /** Server the change would go to, by registered name. */
  server: string
  /** e.g. 'set-status', 'post-comment'. */
  operation: string
  /** e.g. the issue key. */
  target: string
  payload: unknown
}

export type RemoteOutcome =
  | { ok: true; detail: string }
  | { ok: false; error: string }

/** Carries the user-facing description of exactly what would be sent. */
export interface RemoteProposal extends ProposedRemoteChange {
  id: string
  /** Plain-language description shown before the user confirms. */
  summary: string
  createdAt: string
}

/**
 * The operation that ACTUALLY talks to the remote system.
 *
 * Deliberately not part of any tool surface: the model can propose, and the
 * application applies. "Always ask the user first" in a system prompt is a
 * request; making the mutating operation unreachable from the model's tools is
 * a constraint. It also gives SC-005 something inspectable — there is simply
 * no path from a model tool call to a remote write.
 */
export interface RemoteMutator {
  apply(change: ProposedRemoteChange): Promise<RemoteOutcome>
}

export interface ProposalQueue {
  propose(change: ProposedRemoteChange, summary: string): RemoteProposal
  list(): RemoteProposal[]
  /** Drops a proposal without applying it. */
  dismiss(id: string): void
  /** Applies exactly the confirmed change, and reports its outcome. */
  confirm(id: string, mutator: RemoteMutator): Promise<RemoteOutcome>
}

/**
 * An in-memory proposal queue. Proposals are per-session working state, not
 * durable configuration — a proposal the user never confirmed is gone on
 * restart, which is the safe direction for a change that was never made.
 */
export function createProposalQueue(clock: { nowIso(): string }, newId: () => string): ProposalQueue {
  const proposals = new Map<string, RemoteProposal>()
  return {
    propose(change, summary) {
      const proposal: RemoteProposal = { ...change, id: newId(), summary, createdAt: clock.nowIso() }
      proposals.set(proposal.id, proposal)
      return proposal
    },
    list: () => [...proposals.values()],
    dismiss(id) {
      proposals.delete(id)
    },
    async confirm(id, mutator) {
      const proposal = proposals.get(id)
      if (!proposal) return { ok: false, error: 'that change is no longer pending' }
      // Consume before applying: a confirmation covers ONE change, so a retry
      // can never double-apply it.
      proposals.delete(id)
      try {
        const { id: _ignored, summary: _s, createdAt: _c, ...change } = proposal
        const outcome = await mutator.apply(change)
        // A failure is reported as a failure — never presented as success
        // (FR-024).
        return outcome
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    }
  }
}

/**
 * The tool surface a session may be shown.
 *
 * Only ever the proposal tool. There is deliberately no path that adds a
 * mutator here, and no configuration that changes that — which is what makes
 * "no remote change without a confirmation" a property rather than a promise.
 */
export function remoteToolSurface(propose: (change: ProposedRemoteChange) => RemoteProposal): {
  name: string
  description: string
  call: (change: ProposedRemoteChange) => { status: 'proposed'; id: string }
}[] {
  return [
    {
      name: 'propose_remote_change',
      description:
        'Propose a change to a connected external system. This does NOT perform the change: it is shown to the user, who must confirm it before it happens. Use it for status changes and comments.',
      call: (change) => ({ status: 'proposed', id: propose(change).id })
    }
  ]
}
