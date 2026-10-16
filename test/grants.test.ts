import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSessionContext,
  createProposalQueue,
  declaredInputsOnly,
  remoteToolSurface,
  resolveGrant,
  type ProposedRemoteChange,
  type RemoteMutator
} from '../src/core/domain/grant'
import { NO_GRANT, type PluginGrant, type TaskTypeDef } from '../src/shared/types'
import type { SessionPurpose } from '../src/core/ports/agent'

// Grant resolution, confinement, the egress boundary, and the propose/confirm
// split.
//
// Feature 002 (D9, FR-015): grants are NO LONGER a Type declaration — the
// field does not exist on TaskTypeDef, so no configuration can confer reach.
// The resolution and egress machinery stays (this file pins it) because the
// later grants feature re-adds the declaration against the same guarantees:
// a confined purpose resolves NO_GRANT unconditionally, and a granted session
// sees less, by construction.
//
// Everything here is asserted against a scripted tool double; no real external
// system is contacted and no live MCP connection is made.

const aType = (): TaskTypeDef => ({
  key: 'doc_like',
  family: 'document',
  label: 'Doc',
  emoji: '📄',
  inputSchema: [],
  isBuiltin: false,
  finishBehaviour: 'polish-then-file'
})

// The grants a LATER feature would declare; today nothing can supply them
// from a Type. The literal stands in for the declaration the resolver reads.
const GRANTS: PluginGrant = { skills: ['summarize'], toolServers: ['jira'] }

// Every confined purpose the feature defines: organizing, curating,
// conversing — all of feature 002's assistant steps.
const CONFINED_PURPOSES: SessionPurpose[] = ['confined']

// ---- D9, FR-015 ----

test('grant resolution: an interactive session receives the grants it is handed', () => {
  assert.deepEqual(resolveGrant({ purpose: 'interactive', grants: GRANTS }), { skills: ['summarize'], toolServers: ['jira'] })
})

test('grant resolution: nothing supplied gets none — and no Type can supply any', () => {
  assert.deepEqual(resolveGrant({ purpose: 'interactive', grants: NO_GRANT }), NO_GRANT)
  assert.deepEqual(resolveGrant({ purpose: 'interactive', grants: null }), NO_GRANT)
  assert.deepEqual(resolveGrant({ purpose: 'interactive' }), NO_GRANT)
  // The structural half of D9: the declaration itself does not exist.
  assert.equal('grants' in aType(), false, 'TaskTypeDef must not grow a grants field without a spec')
})

test('a confined build returns NO_GRANT unconditionally, even with a grant in hand', () => {
  for (const purpose of CONFINED_PURPOSES) {
    assert.deepEqual(resolveGrant({ purpose, grants: GRANTS }), NO_GRANT)
  }
})

test('conformance over every confined purpose: the most permissive grant still yields nothing', () => {
  // The guarantee is architectural, not convention-driven: no value a caller
  // can produce makes a confined operation privileged.
  const mostPermissive: PluginGrant = { skills: ['*'], toolServers: ['jira', 'github', 'shell'] }
  for (const purpose of CONFINED_PURPOSES) {
    const grant = resolveGrant({ purpose, grants: mostPermissive })
    assert.deepEqual(grant, NO_GRANT)
    assert.equal(grant.skills.length + grant.toolServers.length, 0)
  }
  // A caller that omits the purpose entirely is treated as confined by the
  // session factory, so the default is the safe answer too.
  assert.deepEqual(resolveGrant({ purpose: 'confined' }), NO_GRANT)
})

// ---- FR-029, SC-010: the egress boundary ----

test('a granted interactive session excludes working content; an ungranted one is unchanged', () => {
  const task = {
    title: 'AUTH-42',
    notes: 'look at the timeout',
    inputs: { sourceKind: 'issue', sourceText: 'pasted body', target: 'unblock the release' }
  }
  // What today's context builder would produce for an ungranted session: the
  // note and the task's whole picture.
  const FULL = 'Task: AUTH-42\nWorking-area draft:\nSECRET MINUTES'

  const ungranted = buildSessionContext({
    task,
    purpose: 'interactive',
    fullContext: () => FULL
  })
  assert.equal(ungranted, FULL, 'an ungranted session sees exactly what it saw before')

  const granted = buildSessionContext({
    task,
    grants: GRANTS,
    purpose: 'interactive',
    fullContext: () => FULL
  })!
  assert.ok(!granted.includes('SECRET MINUTES'), 'working content is excluded once reach is granted')
  assert.ok(granted.includes('pasted body'), 'declared inputs still reach the session')
  assert.ok(granted.includes('unblock the release'))
})

test('a confined session keeps the full context (it has nowhere to send it)', () => {
  const FULL = 'Task: x\nWorking-area draft:\nNOTES'
  const ctx = buildSessionContext({
    task: { title: 'x', notes: '', inputs: {} },
    grants: GRANTS,
    purpose: 'confined',
    fullContext: () => FULL
  })
  assert.equal(ctx, FULL)
})

test('declaredInputsOnly carries the inputs and nothing else', () => {
  const out = declaredInputsOnly({ title: 'T', notes: 'desc', inputs: { a: '1', b: '', c: 2 } })
  assert.equal(out, 'Task: T\nDescription: desc\na: 1')
  assert.ok(!out.includes('c:'), 'non-string inputs are not interpolated')
})

// ---- FR-022, FR-023, SC-005: remote changes ----

test('a proposal produces no remote call', async () => {
  const calls: ProposedRemoteChange[] = []
  const mutator: RemoteMutator = {
    async apply(change) {
      calls.push(change)
      return { ok: true, detail: 'applied' }
    }
  }
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => 'p1')
  const tools = remoteToolSurface((change) => queue.propose(change, `Would set ${change.target} to ${JSON.stringify(change.payload)}`))

  const result = tools[0]!.call({ server: 'jira', operation: 'set-status', target: 'AUTH-42', payload: { status: 'Done' } })
  assert.deepEqual(result, { status: 'proposed', id: 'p1' })

  // Nothing reached the remote: proposing is not performing.
  assert.deepEqual(calls, [])
  assert.equal(queue.list().length, 1)
  assert.ok(queue.list()[0]!.summary.includes('AUTH-42'), 'the user is told exactly what would be sent')
})

test('confirming applies exactly that change', async () => {
  const calls: ProposedRemoteChange[] = []
  const mutator: RemoteMutator = {
    async apply(change) {
      calls.push(change)
      return { ok: true, detail: 'status set' }
    }
  }
  let n = 0
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => `p${++n}`)
  const a = queue.propose({ server: 'jira', operation: 'set-status', target: 'AUTH-42', payload: { status: 'Done' } }, 'set AUTH-42 Done')
  queue.propose({ server: 'jira', operation: 'post-comment', target: 'AUTH-42', payload: { body: 'hi' } }, 'comment on AUTH-42')

  const outcome = await queue.confirm(a.id, mutator)
  assert.deepEqual(outcome, { ok: true, detail: 'status set' })
  assert.equal(calls.length, 1, 'exactly one change was applied')
  assert.equal(calls[0]!.operation, 'set-status')

  // A confirmation covers one change, and cannot be replayed.
  const again = await queue.confirm(a.id, mutator)
  assert.equal(again.ok, false)
  assert.equal(calls.length, 1)
})

test('an unconfirmed conversational request never reaches the remote', async () => {
  let called = 0
  const mutator: RemoteMutator = {
    async apply() {
      called++
      return { ok: true, detail: 'applied' }
    }
  }
  let n = 0
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => `p${++n}`)
  // The model "asks" repeatedly; each produces a proposal, none produces a call.
  for (let i = 0; i < 3; i++) queue.propose({ server: 'jira', operation: 'set-status', target: 'AUTH-42', payload: {} }, 'set it')
  assert.equal(called, 0)
  assert.equal(queue.list().length, 3)
  for (const p of queue.list()) queue.dismiss(p.id)
  assert.equal(called, 0, 'dismissing never applies')
})

test('the mutator is structurally absent from the tool surface exposed to the model', () => {
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => 'p1')
  const tools = remoteToolSurface((c) => queue.propose(c, 'x'))
  // The strong form of SC-005: there is no callable path from a model tool to
  // a remote write. A runtime denial would be a second layer; this is the
  // first, and it reasons from reachability rather than from intent.
  assert.equal(tools.length, 1)
  assert.equal(tools[0]!.name, 'propose_remote_change')
  const callable = tools[0]!.call as unknown as (...args: unknown[]) => unknown
  assert.equal(callable.length, 1, 'the proposal tool takes only the proposed change')
  // Nothing on the surface references applying.
  assert.ok(!JSON.stringify(tools.map((t) => t.name)).match(/apply|mutate|execute|confirm/i))
})

// ---- FR-024: failures are reported, never presented as success ----

test('a failed remote operation reports the failure and is never reported as success', async () => {
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => 'p1')
  const p = queue.propose({ server: 'jira', operation: 'set-status', target: 'AUTH-42', payload: {} }, 'set it')

  const unreachable: RemoteMutator = { apply: async () => ({ ok: false, error: 'tool server unreachable' }) }
  const rejected = await queue.confirm(p.id, unreachable)
  assert.equal(rejected.ok, false)
  assert.ok(!('detail' in rejected))

  // A mutator that throws is reported too, rather than escaping as a crash.
  const throwing: RemoteMutator = {
    apply: async () => {
      throw new Error('connection reset')
    }
  }
  const p2 = queue.propose({ server: 'jira', operation: 'set-status', target: 'AUTH-42', payload: {} }, 'set it')
  const threw = await queue.confirm(p2.id, throwing)
  assert.deepEqual(threw, { ok: false, error: 'connection reset' })
})

test('confirming a proposal that is gone reports it rather than silently doing nothing', async () => {
  const queue = createProposalQueue({ nowIso: () => '2026-01-01T00:00:00.000Z' }, () => 'p1')
  const mutator: RemoteMutator = { apply: async () => ({ ok: true, detail: 'x' }) }
  const outcome = await queue.confirm('never-existed', mutator)
  assert.equal(outcome.ok, false)
  assert.ok(outcome.ok === false && outcome.error.includes('no longer pending'))
})

// The two preprocess-instruction tests that used to close this file died with
// the engine (D4). The wiring guarantee they pinned — a confined run resolves
// NO_GRANT whatever the configuration says — is the conformance test above,
// and it no longer has a permissive instruction to leak into: every assistant
// step this feature runs (organize, curate, converse) is confined.
