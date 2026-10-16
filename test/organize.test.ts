import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, loadSettings, createList, createTask, getTask, saveNotes, getNotes, type DB } from '../src/main/db'
import { getTypeDef, updateTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createAgentSessionAdapter } from '../src/main/adapters/agent/sessionAdapter'
import { artifactStoreFor } from '../src/main/adapters/artifacts'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, type FinishDeps } from '../src/core/services/finishService'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import { loadRuntimeSettings } from '../src/main/runtimeSettings'
import { issueKeysOf } from './helpers/issues'
import type { Settings } from '../src/shared/types'

// US1 (T014): the write → organize → file loop of a Document task.
//
// Everything is scripted at the setSessionFactory seam — no provider, no
// network. The draft is the task's working-area note (D3), and the guarantees
// under test are the spec's: the draft survives every finish byte-identical
// (FR-002), collisions never overwrite (FR-004), a broken assistant never
// changes the user's words (FR-005), the as-written choice runs no session at
// all (FR-003/US1-AC7), a blank draft refuses while the task stays active
// (US1-AC6), and the off state files as written with zero outbound calls
// (FR-021/SC-002).

const DRAFT = `weekly blog draft

the argument: WSL2 networking confuses people because NAT hides the host.
decision: explain the mirror-mode fix first, then the port-forwarding workaround.
todo: add a diagram of the NAT path.
`

let factoryCalls = 0

/** Script the organize step's JSON output at the seam, counting constructions. */
function scriptOrganize(organizer: (draft: string) => string): void {
  factoryCalls = 0
  setSessionFactory(async (opts: CreateJobSessionOptions): Promise<JobSessionLike> => {
    factoryCalls++
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt(text: string) {
        const draft = text.split('===DOCUMENT AS WRITTEN BY THE USER===')[1]?.trim() ?? text
        messages.push({ role: 'assistant', content: [{ type: 'text', text: organizer(draft) }] })
      },
      async abort() {},
      async dispose() {}
    }
  })
}

const organizeOk = (draft: string): string =>
  JSON.stringify({
    // A faithful re-organization: same facts, tighter structure. Every
    // preserved fact quotes the draft, so verifyPolish accepts it.
    polished: `# WSL2 networking\n\n## The argument\n${draft.includes('NAT hides the host') ? 'NAT hides the host, which confuses people.' : 'the argument.'}\n\n## Decision\nExplain the mirror-mode fix first, then the port-forwarding workaround.\n\n## Todo\nAdd a diagram of the NAT path.`,
    preservedFacts: ['NAT hides the host', 'explain the mirror-mode fix first', 'add a diagram of the NAT path']
  })

function harness(assistantRuntime: 'on' | 'off' = 'on'): { conn: DB; dir: string; outDir: string; taskId: string; settings: Settings } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-organize-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  const settings: Settings = {
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    uiLanguage: 'en',
    assistantRuntime,
    lastCheck: null,
    skills: [],
    mcpServers: []
  }
  saveSettings(conn.db, settings)
  storeProviderKey('openai', 'sk-scripted')
  ensureVault()
  const outDir = path.join(dir, 'filed')
  ensureDestination(outDir)
  // The fresh-install guided refusal is T015's subject; here the built-in
  // Document Type is already pointed at a scratch folder (quickstart §1).
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'document')!,
    destination: { store: 'folder', rootPath: outDir, subdir: '' }
  })
  const list = createList(conn.db, 'Writing')
  const task = createTask(conn.db, { listId: list.id, title: 'WSL2 networking blog', type: 'document' })
  saveNotes(conn.db, { taskId: task.id, notePath: path.join(dir, 'vault', 'notes', `${task.id}.md`), content: DRAFT })
  return { conn, dir, outDir, taskId: task.id, settings }
}

function depsFor(conn: DB, assistantEnabled: boolean): FinishDeps {
  return {
    language: 'en',
    assistantEnabled,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: artifactStoreFor(),
    session: createAgentSessionAdapter(() => loadRuntimeSettings(conn.db)),
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {}
  }
}

afterEach(() => {
  setSessionFactory(null)
})

test('an assisted finish files the organized copy and the draft survives byte-identical (FR-002/FR-003)', async () => {
  const { conn, outDir, taskId } = harness()
  scriptOrganize(organizeOk)
  const draftBefore = getNotes(conn.db, taskId)!.content

  const outcome = await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })

  assert.equal(outcome.task.completed, true)
  assert.equal(outcome.report.ok, true)
  assert.equal(outcome.report.path, 'organized')
  assert.equal(outcome.report.assistantStep, 'ran')
  assert.equal(factoryCalls, 1, 'exactly one organize session was constructed')

  // The filed copy exists at the declared destination and is the organized text.
  const filed = fs.readdirSync(outDir)
  assert.deepEqual(filed, ['wsl2-networking-blog.md'])
  const written = fs.readFileSync(path.join(outDir, filed[0]!), 'utf-8')
  assert.ok(written.includes('# WSL2 networking'), 'the organized document was filed')
  assert.ok(!written.includes('weekly blog draft'), 'not the raw draft')
  assert.equal(outcome.report.artifact?.store, 'folder')
  assert.equal(outcome.report.artifact?.path, path.join(outDir, 'wsl2-networking-blog.md'))

  // The draft on the task is byte-identical after the finish (FR-002).
  assert.equal(getNotes(conn.db, taskId)!.content, draftBefore)
  assert.equal(getNotes(conn.db, taskId)!.content, DRAFT)
  conn.close()
})

test('a same-titled second finish files a distinct name and never touches the first (FR-004)', async () => {
  const { conn, outDir, taskId } = harness()
  scriptOrganize(organizeOk)
  await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })
  const firstPath = path.join(outDir, 'wsl2-networking-blog.md')
  const firstBytes = fs.readFileSync(firstPath)

  // Reopen, edit, finish again — a second artifact lands beside the first.
  const second = await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })
  assert.equal(second.report.path, 'organized')
  assert.deepEqual(fs.readdirSync(outDir).sort(), ['wsl2-networking-blog-2.md', 'wsl2-networking-blog.md'])
  assert.ok(fs.readFileSync(firstPath).equals(firstBytes), 'the first artifact is byte-identical')
  conn.close()
})

test('a fabricated organize output files the draft AS WRITTEN and reports the step failed (FR-005)', async () => {
  const { conn, outDir, taskId } = harness()
  // The assistant asserts a fact the draft does not contain.
  scriptOrganize(() =>
    JSON.stringify({
      polished: 'The team agreed to migrate every service to Kubernetes next quarter.',
      preservedFacts: ['migrate every service to Kubernetes next quarter']
    })
  )

  const outcome = await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })

  assert.equal(outcome.task.completed, true, 'the finish still completes (FR-006)')
  assert.equal(outcome.report.assistantStep, 'failed')
  assert.equal(outcome.report.path, 'as-written', 'what was FILED is the user’s words')
  const written = fs.readFileSync(path.join(outDir, 'wsl2-networking-blog.md'), 'utf-8')
  assert.equal(written, DRAFT, 'a broken assistant never changes the user’s words')
  assert.ok(!written.includes('Kubernetes'))
  conn.close()
})

test("mode 'as-written' files the exact words and constructs no session at all (FR-003/US1-AC7)", async () => {
  const { conn, outDir, taskId } = harness()
  scriptOrganize(organizeOk)

  const outcome = await finishTask(depsFor(conn, true), taskId, { mode: 'as-written' })

  assert.equal(factoryCalls, 0, 'the session factory was never called')
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'skipped')
  assert.equal(fs.readFileSync(path.join(outDir, 'wsl2-networking-blog.md'), 'utf-8'), DRAFT)
  assert.equal(outcome.task.completed, true)
  conn.close()
})

test('a blank working area refuses with document.empty and the task stays active (US1-AC6)', async () => {
  const { conn, outDir, taskId } = harness()
  saveNotes(conn.db, { taskId, notePath: 'notes/x.md', content: '   \n  ' })
  scriptOrganize(organizeOk)

  await assert.rejects(
    () => finishTask(depsFor(conn, true), taskId, { mode: 'assisted' }),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['document.empty'])
      return true
    }
  )
  assert.equal(getTask(conn.db, taskId)!.completed, false, 'the task stays actionable')
  assert.deepEqual(fs.readdirSync(outDir), [], 'nothing was filed')
  assert.equal(factoryCalls, 0, 'and no session was constructed for a refusal')
  // The as-written path refuses too: there are no words to file.
  await assert.rejects(() => finishTask(depsFor(conn, true), taskId, { mode: 'as-written' }), (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), ['document.empty'])
    return true
  })
  conn.close()
})

test('assistant off: the mode is forced as-written, zero seam invocations, filing completes (FR-021/SC-002)', async () => {
  const { conn, outDir, taskId } = harness('off')
  scriptOrganize(organizeOk)

  // Even when the caller asks for 'assisted', the switch wins: no session is
  // constructed and the words are filed as written.
  const outcome = await finishTask(depsFor(conn, false), taskId, { mode: 'assisted' })

  assert.equal(factoryCalls, 0, 'zero outbound calls while off')
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'skipped', 'the app plainly says the organizing step did not run')
  assert.equal(outcome.task.completed, true)
  assert.equal(fs.readFileSync(path.join(outDir, 'wsl2-networking-blog.md'), 'utf-8'), DRAFT)
  conn.close()
})

test('never configured: same forced as-written path, no session (SC-002)', async () => {
  const { conn, outDir, taskId } = harness()
  // The model service was never configured: no key presence, no model.
  saveSettings(conn.db, { ...loadSettings(conn.db), hasApiKey: false, model: '' })
  scriptOrganize(organizeOk)

  const outcome = await finishTask(depsFor(conn, true), taskId)
  assert.equal(factoryCalls, 0)
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'skipped')
  assert.equal(outcome.task.completed, true)
  assert.equal(fs.readFileSync(path.join(outDir, 'wsl2-networking-blog.md'), 'utf-8'), DRAFT)
  conn.close()
})

test('the switch thrown off mid-assist: the in-flight step is honestly reported and nothing new starts while off', async () => {
  const { conn, outDir, taskId } = harness()
  // The scripted session flips the switch OFF while the organize step is in
  // flight (the edge case): the step already running completes and is
  // reported honestly — completed OR failed, never silently dropped.
  setSessionFactory(async (opts: CreateJobSessionOptions) => {
    factoryCalls++
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt() {
        saveSettings(conn.db, { ...loadSettings(conn.db), assistantRuntime: 'off' })
        messages.push({ role: 'assistant', content: [{ type: 'text', text: organizeOk(DRAFT) }] })
      },
      async abort() {},
      async dispose() {}
    }
  })
  factoryCalls = 0

  const outcome = await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })
  assert.equal(outcome.report.assistantStep, 'ran', 'the in-flight step is reported as what it was: completed')
  assert.equal(outcome.report.path, 'organized')
  assert.equal(outcome.task.completed, true)

  // While off, nothing NEW starts: a second finish files as written with zero
  // session constructions.
  const before = factoryCalls
  const second = await finishTask(depsFor(conn, false), taskId, { mode: 'assisted' })
  assert.equal(factoryCalls, before, 'no new session while the switch is off')
  assert.equal(second.report.path, 'as-written')
  assert.equal(second.report.assistantStep, 'skipped')
  conn.close()
})

test('a very large draft still finishes: oversized input degrades to as-written filing, never a size failure', async () => {
  const { conn, outDir, taskId } = harness()
  const huge = DRAFT + 'x'.repeat(300_000)
  saveNotes(conn.db, { taskId, notePath: 'notes/x.md', content: huge })
  // The organize step cannot produce traceable output for the truncated tail;
  // whatever it returns, the finish files SOMETHING and completes.
  scriptOrganize(() => JSON.stringify({ polished: 'too big to organize faithfully', preservedFacts: ['a fact nobody wrote down'] }))

  const outcome = await finishTask(depsFor(conn, true), taskId, { mode: 'assisted' })
  assert.equal(outcome.task.completed, true)
  // The bound caught the fabrication: the user's own (huge) draft is filed.
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'failed')
  assert.equal(fs.readFileSync(path.join(outDir, 'wsl2-networking-blog.md'), 'utf-8'), huge)
  conn.close()
})
