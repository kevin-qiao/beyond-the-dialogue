import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, createTask, getTask, saveNotes } from '../src/main/db'
import { getTypeDef, updateTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createAgentSessionAdapter } from '../src/main/adapters/agent/sessionAdapter'
import { artifactStoreFor } from '../src/main/adapters/artifacts'
import { ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, type FinishDeps } from '../src/core/services/finishService'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import { loadRuntimeSettings } from '../src/main/runtimeSettings'
import { issueKeysOf } from './helpers/issues'
import { message } from '../src/core/i18n'

// FR-007 / Q1 / quickstart §3 (T015): the fresh install's first Finish.
//
// The built-in generic Document Type ships with NO location — deliberately:
// the first Finish is the guided refusal that asks the user to choose, and no
// default ever takes its place. This file starts from a genuinely fresh
// database (the post-v13 seed) and walks the guided path.

const DRAFT = 'My first document.\n\nIt has two paragraphs worth of thought.\n'

function freshInstall(): { conn: ReturnType<typeof openDB>; dir: string; taskId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fresh-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: true,
    theme: 'light',
    uiLanguage: 'en',
    assistantRuntime: 'on',
    lastCheck: null,
    skills: [],
    mcpServers: []
  })
  storeProviderKey('openai', 'sk-scripted')
  ensureVault()
  const list = createList(conn.db, 'Writing')
  const task = createTask(conn.db, { listId: list.id, title: 'first post', type: 'document' })
  saveNotes(conn.db, { taskId: task.id, notePath: path.join(dir, 'vault', 'notes', `${task.id}.md`), content: DRAFT })
  return { conn, dir, taskId: task.id }
}

function depsFor(conn: ReturnType<typeof openDB>): FinishDeps {
  return {
    language: 'en',
    assistantEnabled: true,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: artifactStoreFor(),
    session: createAgentSessionAdapter(() => loadRuntimeSettings(conn.db)),
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {}
  }
}

let factoryCalls = 0
function scriptSession(): void {
  factoryCalls = 0
  setSessionFactory(async (_opts: CreateJobSessionOptions): Promise<JobSessionLike> => {
    factoryCalls++
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt() {
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify({ polished: 'My first document, organized.', preservedFacts: ['two paragraphs worth of thought'] }) }]
        })
      },
      async abort() {},
      async dispose() {}
    }
  })
}

afterEach(() => setSessionFactory(null))

test('a fresh database seeds the built-in Document Type with no location (Q1)', () => {
  const { conn } = freshInstall()
  const doc = conn.db.prepare("SELECT * FROM task_types WHERE key='document'").get() as any
  assert.equal(doc.family, 'document')
  assert.equal(doc.is_builtin, 1)
  assert.equal(doc.finish_behaviour, 'polish-then-file')
  assert.deepEqual(JSON.parse(doc.destination_json), { store: 'folder', rootPath: '', subdir: '' })
  conn.close()
})

test('the first Finish on a fresh install is the guided refusal, and the task stays actionable (FR-007)', async () => {
  const { conn, dir, taskId } = freshInstall()
  scriptSession()

  await assert.rejects(
    () => finishTask(depsFor(conn), taskId, { mode: 'assisted' }),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['destination.notConfigured'])
      return true
    }
  )

  // The refusal is phrasable — a real sentence in both languages, telling the
  // user what to fix (the localized message is what crosses IPC).
  const enText = message('en', 'destination.notConfigured')
  assert.ok(enText.includes('Settings'), `the refusal names where to fix it: ${enText}`)
  assert.notEqual(message('zh-CN', 'destination.notConfigured'), enText)

  // The task is untouched: still actionable, nothing filed, no session built.
  assert.equal(getTask(conn.db, taskId)!.completed, false)
  assert.equal(factoryCalls, 0, 'a refusal constructs no session')
  assert.equal(fs.existsSync(path.join(dir, 'filed')), false, 'no location was invented')

  // Point the Type at a scratch folder (the guided fix, via the types:save
  // path) — the SAME finish now files.
  const scratch = path.join(dir, 'filed')
  ensureDestination(scratch)
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'document')!,
    destination: { store: 'folder', rootPath: scratch, subdir: '' }
  })
  const outcome = await finishTask(depsFor(conn), taskId, { mode: 'assisted' })
  assert.equal(outcome.task.completed, true)
  assert.equal(outcome.report.path, 'organized')
  assert.deepEqual(fs.readdirSync(scratch), ['first-post.md'])
  conn.close()
})

test('the destination lost between save and finish refuses with destination.unreachable — never half-filed, never substituted (US1-AC5)', async () => {
  const { conn, dir, taskId } = freshInstall()
  scriptSession()
  const scratch = path.join(dir, 'filed')
  ensureDestination(scratch)
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'document')!,
    destination: { store: 'folder', rootPath: scratch, subdir: '' }
  })

  // The folder is deleted (or unmounted) after the Type was saved.
  fs.rmSync(scratch, { recursive: true, force: true })

  await assert.rejects(
    () => finishTask(depsFor(conn), taskId, { mode: 'as-written' }),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['destination.unreachable'])
      return true
    }
  )
  assert.equal(getTask(conn.db, taskId)!.completed, false, 'the task stays actionable')
  assert.equal(fs.existsSync(scratch), false, 'nothing was half-filed and no location was substituted')
  assert.ok(message('en', 'destination.unreachable').includes('no longer exists'))
  conn.close()
})
