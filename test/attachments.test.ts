import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, createTask, getTask, listAttachments, deleteTask } from '../src/main/db'
import { createAttachmentStore } from '../src/main/adapters/attachments'
import { setUserDataRoot } from '../src/main/paths'
import { MAX_ATTACHMENT_BYTES } from '../src/core/domain/attachment'
import { isLocalizedError } from '../src/core/i18n/issues'

// The attachment feature end to end at the port boundary (feature 001, US1,
// T019): real files on a real tmp root, through the real adapter. What is
// NOT tested here is the Electron half — the file dialog and shell.openPath
// live in the IPC handlers and are exercised by the quickstart §4 pass.

function fresh() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-att-'))
  setUserDataRoot(dataRoot)
  const conn = openDB(dataRoot)
  migrate(conn.db)
  const list = createList(conn.db, 'Work')
  const task = createTask(conn.db, { listId: list.id, title: 'with material' })
  const store = createAttachmentStore(conn.db)
  const srcDir = fs.mkdtempSync(path.join(dataRoot, 'sources-'))
  return { dataRoot, conn, task, store, srcDir }
}

function makeSource(dir: string, name: string, content: string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

test('copy-in survives the original being moved or deleted (US1-AC3, FR-003)', () => {
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const src = makeSource(srcDir, 'notes.md', '# the material\n')
  const a = store.copyIn(task.id, src)

  assert.ok(a.id)
  assert.equal(a.taskId, task.id)
  assert.equal(a.name, 'notes.md')
  assert.ok(a.path.startsWith(`attachments/${a.id}/`), 'the id owns the stored file')
  assert.ok(!path.isAbsolute(a.path), 'the stored path is relative-only (FR-021)')

  // Move the original away — the application's copy is unaffected.
  fs.renameSync(src, src + '.moved')
  const resolved = store.resolveStored(a.id)
  assert.ok(resolved)
  assert.equal(fs.readFileSync(resolved.absPath, 'utf-8'), '# the material\n')

  fs.rmSync(src + '.moved')
  assert.ok(store.resolveStored(a.id), 'and still readable with the original gone entirely')
  conn.close()
})

test('over-cap refuses with a stated reason and the task keeps its other content', () => {
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const big = path.join(srcDir, 'huge.bin')
  fs.writeFileSync(big, '')
  fs.truncateSync(big, MAX_ATTACHMENT_BYTES + 1) // sparse: instant, and over the cap

  assert.throws(
    () => store.copyIn(task.id, big),
    (e: unknown) => isLocalizedError(e) && e.issues[0]?.key === 'attachment.tooLarge'
  )
  assert.deepEqual(listAttachments(conn.db, task.id), [], 'nothing was stored')
  assert.ok(getTask(conn.db, task.id), 'the task is untouched')
  conn.close()
})

test('unreadable source refuses with a reason', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root ignores file permission bits')
    return
  }
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const src = makeSource(srcDir, 'secret.txt', 'nope')
  fs.chmodSync(src, 0o000)
  try {
    assert.throws(
      () => store.copyIn(task.id, src),
      (e: unknown) => isLocalizedError(e) && e.issues[0]?.key === 'attachment.unreadable'
    )
    assert.deepEqual(listAttachments(conn.db, task.id), [])
  } finally {
    fs.chmodSync(src, 0o644)
    conn.close()
  }
})

test('remove drops the row and the stored file together', () => {
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const a = store.copyIn(task.id, makeSource(srcDir, 'one.txt', '1'))
  store.remove(a.id)
  assert.equal(listAttachments(conn.db, task.id).length, 0)
  assert.equal(fs.existsSync(path.join(dataRoot, `attachments/${a.id}`)), false, 'the stored directory is gone')
  conn.close()
})

test('purgeForTask on a confirmed delete removes every row and file (FR-004)', () => {
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const a = store.copyIn(task.id, makeSource(srcDir, 'one.txt', '1'))
  const b = store.copyIn(task.id, makeSource(srcDir, 'two.txt', '2'))

  // The handler order the delete path follows: soft-delete the task, then
  // purge its attachments (rows + files).
  deleteTask(conn.db, task.id)
  store.purgeForTask(task.id)

  assert.equal(getTask(conn.db, task.id)!.deletedAt !== null, true, 'the task is tombstoned')
  assert.deepEqual(listAttachments(conn.db, task.id), [])
  for (const id of [a.id, b.id]) {
    assert.equal(fs.existsSync(path.join(dataRoot, `attachments/${id}`)), false, `stored file ${id} gone`)
  }
  conn.close()
})

test('a stored file that vanished reads as missing — the open refusal source (T023)', () => {
  const { dataRoot, conn, task, store, srcDir } = fresh()
  const a = store.copyIn(task.id, makeSource(srcDir, 'gone.txt', 'x'))
  fs.rmSync(path.join(dataRoot, `attachments/${a.id}`, 'gone.txt'))
  assert.equal(store.resolveStored(a.id), null, 'missing copy ⇒ the handler refuses with attachment.missing')
  conn.close()
})
