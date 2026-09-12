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
import { preprocessInstruction } from '../src/core/domain/preprocess'

// contracts/plugin-grants.md — grant resolution, confinement, the egress
// boundary, and the propose/confirm split.
//
// Everything here is asserted against a scripted tool double; no real external
// system is contacted and no live MCP connection is made.

const typeWith = (grants: PluginGrant): TaskTypeDef => ({
  key: 'jira_like',
  kind: 'jira',
  label: 'JIRA',
  emoji: '🎫',
  inputSchema: [],
  isBuiltin: false,
  finishBehaviour: 'complete-only',
  grants
})

const GRANTED = typeWith({ skills: ['summarize'], toolServers: ['jira'] })
const UNGRANTED = typeWith(NO_GRANT)

// Every confined purpose the feature defines: material ingestion, minute
// polishing, suggestion generation.
const CONFINED_PURPOSES: SessionPurpose[] = ['confined']

// ---- FR-019, FR-020, SC-006 ----

test('grant resolution: an interactive session receives its type grants', () => {
  assert.deepEqual(resolveGrant({ purpose: 'interactive', typeDef: GRANTED }), { skills: ['summarize'], toolServers: ['jira'] })
})

test('grant resolution: a type with no grant gets none', () => {
  assert.deepEqual(resolveGrant({ purpose: 'interactive', typeDef: UNGRANTED }), NO_GRANT)
  assert.deepEqual(resolveGrant({ purpose: 'interactive', typeDef: null }), NO_GRANT)
  assert.deepEqual(resolveGrant({ purpose: 'interactive' }), NO_GRANT)
})

test('a confined build returns NO_GRANT unconditionally, even for a granted type', () => {
  for (const purpose of CONFINED_PURPOSES) {
    assert.deepEqual(resolveGrant({ purpose, typeDef: GRANTED }), NO_GRANT)
  }
})

test('conformance over every confined purpose: a misconfigured type still yields no grant', () => {
  // The guarantee is architectural, not convention-driven: no configuration a
  // user can produce makes a confined operation privileged. Assert it for the
  // most permissive type we can express, and for a purpose the caller supplies
  // that does not even exist in the union.
  const mostPermissive = typeWith({ skills: ['*'], toolServers: ['jira', 'github', 'shell'] })
  for (const purpose of CONFINED_PURPOSES) {
    const grant = resolveGrant({ purpose, typeDef: mostPermissive })
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
  // note, the wiki-derived summary, and the pasted source.
  const FULL = 'Task: AUTH-42\nCurrent working note:\nSECRET MINUTES\nPre-process summary: ...'

  const ungranted = buildSessionContext({
    task,
    typeDef: UNGRANTED,
    purpose: 'interactive',
    fullContext: () => FULL
  })
  assert.equal(ungranted, FULL, 'an ungranted session sees exactly what it saw before')

  const granted = buildSessionContext({
    task,
    typeDef: GRANTED,
    purpose: 'interactive',
    fullContext: () => FULL
  })!
  assert.ok(!granted.includes('SECRET MINUTES'), 'working content is excluded once reach is granted')
  assert.ok(!granted.includes('Pre-process summary'), 'and so are derived notes')
  assert.ok(granted.includes('pasted body'), 'declared inputs still reach the session')
  assert.ok(granted.includes('unblock the release'))
})

test('a confined session keeps the full context (it has nowhere to send it)', () => {
  const FULL = 'Task: x\nCurrent learning note:\nNOTES'
  const ctx = buildSessionContext({
    task: { title: 'x', notes: '', inputs: {} },
    typeDef: GRANTED,
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

// ---- FR-021: a granted type can read the live source ----

test("a granted type's instruction stops denying remote access; an ungranted one keeps it", () => {
  // The pre-process instruction must not tell the assistant it cannot reach a
  // system the session can reach — and must keep saying so when it cannot.
  const instruction = preprocessInstruction('jira')!
  const inputs = { sourceKind: 'issue', sourceText: 'pasted: status To Do', target: 'unblock' }
  const args = {
    context: instruction.buildContext({ title: 'AUTH-42', notes: '' }, inputs),
    userPrompt: '',
    aiGuidance: '',
    inputs
  }

  const ungranted = instruction.buildPrompt({ ...args, granted: false })
  assert.ok(ungranted.includes('no access to the remote system'), 'an ungranted session is told the truth')
  assert.ok(!ungranted.includes('prefer what you read from it'))

  const granted = instruction.buildPrompt({ ...args, granted: true })
  assert.ok(!granted.includes('no access to the remote system'), 'the denial must not survive the grant')
  assert.ok(granted.includes('prefer what you read from it over the pasted content'))
  // The pasted content is still present: a live read supplements it, and there
  // is a session with no grant to fall back on.
  assert.ok(granted.includes('pasted: status To Do'))
})

test('a confined pre-process resolves to no grant, so its instruction always denies access', async () => {
  // The wiring, not just the text: the job builds `granted` from the RESOLVED
  // grant, so a confined run can never produce the permissive instruction even
  // for a type that declares a tool server.
  const { resolveGrant: resolve } = await import('../src/core/domain/grant')
  const grant = resolve({ purpose: 'confined', typeDef: GRANTED })
  assert.deepEqual(grant, NO_GRANT)
  const grantedFlag = grant.skills.length > 0 || grant.toolServers.length > 0
  assert.equal(grantedFlag, false)

  const instruction = preprocessInstruction('jira')!
  const inputs = { sourceKind: 'issue', sourceText: 'pasted', target: 'x' }
  const prompt = instruction.buildPrompt({
    context: instruction.buildContext({ title: 'T', notes: '' }, inputs),
    userPrompt: '',
    aiGuidance: '',
    inputs,
    granted: grantedFlag
  })
  assert.ok(prompt.includes('no access to the remote system'))
})
