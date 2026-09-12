import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FolderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import type { ArtifactRef, DestinationRef } from '../src/core/ports/artifactStore'

// The folder store's own failure paths. Distinct from test/destination.test.ts
// (which covers the resolver) and the finish tests (which cover the finish
// orchestration): this file is about the store honouring its contract when the
// filesystem says no.

const store = new FolderArtifactStore()

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-store-'))
}

function ref(absRoot: string): ArtifactRef {
  return { store: 'folder', root: absRoot, subdir: '', absRoot, abs: path.join(absRoot, 'minutes.md'), rel: 'minutes.md' }
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

test('prepare rejects a missing destination', async () => {
  const dir = tmpdir()
  const missing = path.join(dir, 'does-not-exist')
  await assert.rejects(() => store.prepare(ref(missing)), /does not exist/)
  // ...and does not create it as a side effect: a finish must not invent a
  // directory the user never declared.
  assert.equal(fs.existsSync(missing), false, 'prepare must not create the folder')
})

test('prepare rejects a destination that is not a directory', async () => {
  const dir = tmpdir()
  const filePath = path.join(dir, 'im-a-file')
  fs.writeFileSync(filePath, 'not a folder')
  await assert.rejects(() => store.prepare(ref(filePath)), /not writable|does not exist/)
})

test('prepare rejects a read-only destination', async () => {
  const dir = tmpdir()
  const dest = path.join(dir, 'readonly')
  fs.mkdirSync(dest)
  fs.chmodSync(dest, 0o555)
  try {
    if (isRoot) {
      // root bypasses the permission bits, so a 0555 directory genuinely is
      // writable and prepare is right to accept it. Asserting the truth here
      // beats skipping and reporting a green suite that proved nothing.
      await store.prepare(ref(dest))
      assert.ok(true, 'running as root: permission bits do not restrict writes')
    } else {
      await assert.rejects(() => store.prepare(ref(dest)), /not writable/)
    }
  } finally {
    fs.chmodSync(dest, 0o755)
  }
})

test('prepare accepts an existing writable destination', async () => {
  const dir = tmpdir()
  await store.prepare(ref(dir))
})

test('writeArtifact on a collision writes a distinct name and leaves the first byte-identical', async () => {
  const dir = tmpdir()
  const first = await store.writeArtifact(ref(dir), 'FIRST VERSION')
  assert.equal(first, path.join(dir, 'minutes.md'))
  const second = await store.writeArtifact(ref(dir), 'SECOND VERSION')
  assert.equal(second, path.join(dir, 'minutes-2.md'))
  const third = await store.writeArtifact(ref(dir), 'THIRD VERSION')

  // Every version is present as an ordinary file, and nothing was displaced.
  assert.deepEqual(fs.readdirSync(dir).sort(), ['minutes-2.md', 'minutes-3.md', 'minutes.md'])
  assert.equal(fs.readFileSync(first, 'utf-8'), 'FIRST VERSION')
  assert.equal(fs.readFileSync(second, 'utf-8'), 'SECOND VERSION')
  assert.equal(fs.readFileSync(third, 'utf-8'), 'THIRD VERSION')
})

test('writeArtifact writes into a subdir destination', async () => {
  const dir = tmpdir()
  const absRoot = path.join(dir, 'minutes')
  const target: ArtifactRef = {
    store: 'folder',
    root: dir,
    subdir: 'minutes',
    absRoot,
    abs: path.join(absRoot, 'sync.md'),
    rel: 'sync.md'
  }
  const written = await store.writeArtifact(target, 'BODY')
  assert.equal(written, path.join(absRoot, 'sync.md'))
  assert.equal(fs.readFileSync(written, 'utf-8'), 'BODY')
})

test('snapshot then diff reports what a mutation touched', async () => {
  const dir = tmpdir()
  fs.writeFileSync(path.join(dir, 'existing.md'), 'OLD')
  const handle = await store.snapshot(ref(dir))
  assert.deepEqual(handle.files, ['existing.md'])
  assert.ok(handle.location && fs.existsSync(path.join(handle.location, 'existing.md')))

  fs.writeFileSync(path.join(dir, 'existing.md'), 'NEW')
  fs.writeFileSync(path.join(dir, 'added.md'), 'ADDED')
  const touched = (await store.diff(handle)).sort()
  assert.deepEqual(touched, ['added.md', 'existing.md'])
})

test('deposit preserves the raw material before any curating step', async () => {
  const dir = tmpdir()
  const attachment = path.join(dir, 'input.md')
  fs.writeFileSync(attachment, 'ATTACHED')
  const result = await store.deposit(ref(dir), {
    taskId: 't1',
    title: 'Weekly sync',
    content: 'MY MINUTES',
    summary: '# summary',
    attachmentPath: attachment
  })
  assert.equal(result.dir, path.join(dir, 'raw', 't1'))
  assert.deepEqual(result.files.sort(), ['ai-summary.md', 'attachment-input.md', 'minutes.md'])
  assert.equal(fs.readFileSync(path.join(result.dir, 'minutes.md'), 'utf-8'), 'MY MINUTES')

  // Re-depositing never overwrites the earlier deposit.
  const second = await store.deposit(ref(dir), { taskId: 't1', title: 'Weekly sync', content: 'NEWER MINUTES' })
  assert.ok(second.files.includes('minutes-2.md'), `got ${second.files}`)
  assert.equal(fs.readFileSync(path.join(result.dir, 'minutes.md'), 'utf-8'), 'MY MINUTES')
})

test('ensureDestination creates a declared folder and leaves an existing one alone', () => {
  const dir = tmpdir()
  const dest = path.join(dir, 'nested', 'minutes')
  ensureDestination(dest)
  assert.ok(fs.existsSync(dest))
  fs.writeFileSync(path.join(dest, 'keep.md'), 'KEEP')
  ensureDestination(dest)
  assert.equal(fs.readFileSync(path.join(dest, 'keep.md'), 'utf-8'), 'KEEP')
  // A relative path is ignored rather than resolved against the cwd.
  ensureDestination('relative/path')
  assert.equal(fs.existsSync(path.resolve('relative/path')), false)
})

test('the store never scaffolds a destination it writes to', async () => {
  // A meeting-minutes folder must stay a plain folder — no wiki/, no schema
  // file, no restructuring (plan.md II; contracts/destination.md §3).
  const dir = tmpdir()
  await store.writeArtifact(ref(dir), 'MINUTES')
  assert.deepEqual(fs.readdirSync(dir), ['minutes.md'])
})

test('SnapshotHandle is inert when there was nothing to protect', async () => {
  const dir = tmpdir()
  const handle = await store.snapshot({ store: 'folder', root: dir, subdir: '', absRoot: dir } as DestinationRef)
  assert.deepEqual(handle.files, [])
  assert.equal(handle.location, null, 'no empty .history directory is left in the user folder')
  assert.deepEqual(fs.readdirSync(dir), [])
})

// ---- the audit walk must follow the destination actually in use (T032) ----

test('a wiki destination with a non-default subdir is visible to snapshot and diff', async () => {
  const { WikiArtifactStore } = await import('../src/main/adapters/artifacts/wikiStore')
  const { ensureWikiDir } = await import('../src/main/wiki/wiki')
  const wiki = tmpdir()
  ensureWikiDir(wiki)
  const store = new WikiArtifactStore(wiki)

  // A custom type whose finished work goes to a directory the historical walk
  // did not know about. `listExistingWikiFiles` used to be the hardcoded pair
  // ['wiki','learning-notes'], so anything else was INVISIBLE to the audit
  // trail — every finish would still report success while the record of what
  // it touched stayed silently empty.
  const target = {
    store: 'wiki' as const,
    root: wiki,
    subdir: 'meeting-notes',
    absRoot: path.join(wiki, 'meeting-notes'),
    abs: path.join(wiki, 'meeting-notes', 'weekly-sync.md'),
    rel: 'weekly-sync.md',
    rootRel: 'meeting-notes/weekly-sync.md'
  }
  fs.mkdirSync(target.absRoot, { recursive: true })
  fs.writeFileSync(target.abs, 'FIRST')

  const handle = await store.snapshot(target)
  assert.ok(handle.files.includes('meeting-notes/weekly-sync.md'), `snapshot covered: ${handle.files}`)

  // The agent modifies it; the diff reports it rather than staying empty.
  fs.writeFileSync(target.abs, 'SECOND')
  const touched = await store.diff(handle)
  assert.ok(touched.includes('meeting-notes/weekly-sync.md'), `diff reported: ${touched}`)
})

test('the audit walk still covers the wiki default when no destination is named', async () => {
  const { WikiArtifactStore } = await import('../src/main/adapters/artifacts/wikiStore')
  const { ensureWikiDir } = await import('../src/main/wiki/wiki')
  const wiki = tmpdir()
  ensureWikiDir(wiki)
  fs.writeFileSync(path.join(wiki, 'learning-notes', 'a-note.md'), 'NOTE')

  const store = new WikiArtifactStore(wiki)
  const handle = await store.snapshot({ store: 'wiki', root: wiki, subdir: '', absRoot: wiki })
  assert.ok(handle.files.includes('learning-notes/a-note.md'), `got ${handle.files}`)
  assert.ok(handle.files.includes('index.md'))
})

// ---- the store lookup (T075) ----

test('artifactStoreFor maps a destination store to its adapter', async () => {
  const { artifactStoreFor } = await import('../src/main/adapters/artifacts')
  const { WikiArtifactStore } = await import('../src/main/adapters/artifacts/wikiStore')
  const storeFor = artifactStoreFor('/some/wiki')

  const wiki = storeFor({ store: 'wiki', rootPath: null, subdir: 'learning-notes' })
  assert.ok(wiki instanceof WikiArtifactStore, 'a wiki destination resolves to the wiki store')
  // Bound to the wiki root it was built with, not a global.
  await assert.rejects(() => wiki.prepare({ store: 'wiki', root: '/some/wiki', subdir: 'x', absRoot: '/nope/does/not/exist/at/all' }))

  const folder = storeFor({ store: 'folder', rootPath: '/home/u/Documents/Minutes', subdir: '' })
  assert.equal(typeof folder.writeArtifact, 'function')
  assert.equal(typeof folder.prepare, 'function')
  assert.ok(!(folder instanceof WikiArtifactStore), 'a folder destination does not get the wiki store')
})

test('two lookups for different wiki roots do not share state', async () => {
  const { artifactStoreFor } = await import('../src/main/adapters/artifacts')
  const a = artifactStoreFor('/wiki-a')({ store: 'wiki', rootPath: null, subdir: '' })
  const b = artifactStoreFor('/wiki-b')({ store: 'wiki', rootPath: null, subdir: '' })
  assert.notEqual(a, b, 'each wiki root gets its own store instance')
})
