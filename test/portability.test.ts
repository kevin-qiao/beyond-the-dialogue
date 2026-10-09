import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  openDB,
  migrate,
  createList,
  listLists,
  createTask,
  listTasks,
  getTask,
  updateTask,
  saveSettings,
  loadSettings,
  listAttachments
} from '../src/main/db'
import { createAttachmentStore } from '../src/main/adapters/attachments'
import { setUserDataRoot } from '../src/main/paths'
import { getProviderKey, machineFingerprint, readSecrets, setMachineFingerprintProvider, storeProviderKey } from '../src/main/secrets'
import { isRelativeStoredPath } from '../src/core/domain/attachment'

// FR-021 / SC-008 / research D6: the application data folder IS the board.
// Two mechanical halves: (1) no absolute path-shaped value ever persists in
// the board tables, and (2) copying the folder to a fresh location restores
// 100 % of the board — attachment readability included — while the stored
// secrets, read by another machine's fingerprint, are treated as absent.

function freshSetup(): { dir: string; attId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-port-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'dark',
    uiLanguage: 'zh-CN',
    assistantRuntime: 'off',
    lastCheck: null,
    skills: [],
    mcpServers: []
  })
  const work = createList(conn.db, 'Work')
  const t = createTask(conn.db, { listId: work.id, title: 'quarterly', background: 'why', target: 'what', notes: 'see link https://x.y/z' })
  updateTask(conn.db, t.id, { alarmAt: new Date(Date.now() + 3_600_000).toISOString() })
  const src = path.join(dir, 'source.txt')
  fs.writeFileSync(src, 'the original bytes')
  const att = createAttachmentStore(conn.db).copyIn(t.id, src)
  fs.rmSync(src)
  storeProviderKey('openai', 'sk-portable-test-value')
  conn.close()
  return { dir, attId: att.id }
}

afterEach(() => setMachineFingerprintProvider(null))

test('the board tables contain no absolute filesystem paths (D6, mechanical)', () => {
  const { dir } = freshSetup()
  const conn = openDB(dir)
  migrate(conn.db)

  const offenders: string[] = []
  for (const table of ['tasks', 'lists', 'settings', 'task_attachments']) {
    const rows = conn.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    for (const row of rows) {
      for (const [col, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue
        // The check is shape-based: a stored reference that begins with a
        // separator (POSIX or Windows drive) could not survive the copy.
        if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value)) {
          offenders.push(`${table}.${col} = ${value.slice(0, 40)}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'board data references nothing outside the folder by absolute path')

  // And attachment paths are the specific relative shape the rule promises.
  const atts = listAttachments(conn.db)
  assert.ok(atts.length >= 1)
  for (const a of atts) assert.ok(isRelativeStoredPath(a.path), `${a.path} is relative to the root`)
  conn.close()
})

test('copying the folder restores the whole board; the secrets re-ask (FR-021, SC-008)', () => {
  const { dir, attId } = freshSetup()

  // The copy: a fresh location, on a different account/machine.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-port-copy-'))
  const dest = path.join(copy, 'app-data')
  fs.cpSync(dir, dest, { recursive: true })
  setMachineFingerprintProvider(() => 'some-other-machine:someone-else')

  setUserDataRoot(dest)
  const conn = openDB(dest)
  migrate(conn.db)

  // 100 % of the board: tasks, lists, attachment readability, settings.
  const lists = listLists(conn.db)
  assert.equal(lists.some((l) => l.name === 'Work'), true)
  const tasks = listTasks(conn.db)
  assert.equal(tasks.length, 1)
  const t = getTask(conn.db, tasks[0]!.id)!
  assert.equal(t.title, 'quarterly')
  assert.equal(t.background, 'why')
  assert.equal(t.target, 'what')
  assert.ok(t.alarmAt, 'the undelivered alarm came across')
  const s = loadSettings(conn.db)
  assert.equal(s.theme, 'dark')
  assert.equal(s.uiLanguage, 'zh-CN')
  assert.equal(s.hasApiKey, true, 'presence persists — the row never had the value')

  // The attachment is readable again from the copied folder alone.
  const resolved = createAttachmentStore(conn.db).resolveStored(attId)
  assert.ok(resolved, 'the stored copy came with the folder')
  assert.equal(fs.readFileSync(resolved!.absPath, 'utf-8'), 'the original bytes')

  // Secrets: present in the file, ABSENT to this machine — the re-enter state.
  assert.equal(fs.existsSync(path.join(dest, 'pi-agent', 'secrets.json')), true, 'the file is in the folder')
  assert.equal(readSecrets().available, false)
  assert.equal(getProviderKey('openai'), null, 'first use asks again')

  // And on the original machine the same folder still works — the gate is
  // per-machine, not per-copy.
  setMachineFingerprintProvider(() => machineFingerprint())
  assert.equal(getProviderKey('openai'), 'sk-portable-test-value')
  conn.close()
})
