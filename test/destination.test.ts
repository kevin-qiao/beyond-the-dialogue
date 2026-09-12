import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  describeDestination,
  isInsideRoot,
  resolveArtifact,
  resolveDestination,
  validateDestination
} from '../src/core/domain/destination'
import { nodePathPort } from '../src/main/adapters/paths'
import { distinctName, slugify } from '../src/core/domain/slug'
import type { Destination } from '../src/shared/types'

// contracts/destination.md §5 — the configuration-time rules.
//
// These are TYPE-CONFIGURATION errors: they are caught when a type is saved,
// not when a finish runs. The two runtime conditions (the artifact resolves
// inside the root; the root is writable) are covered by test/artifactStore.test.ts
// and the finish tests.

const WIKI = '/home/u/Documents/WorkBoard-Wiki'

const wikiDest: Destination = { store: 'wiki', rootPath: null, subdir: 'learning-notes' }
const folderDest: Destination = { store: 'folder', rootPath: '/home/u/Documents/Minutes', subdir: '' }

test('a folder destination requires an absolute rootPath', () => {
  assert.deepEqual(validateDestination(nodePathPort, folderDest), [])
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, rootPath: 'relative/minutes' }),
    ['a folder destination requires an absolute rootPath']
  )
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, rootPath: '' }),
    ['a folder destination requires an absolute rootPath']
  )
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, rootPath: '   ' }),
    ['a folder destination requires an absolute rootPath']
  )
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, rootPath: null }),
    ['a folder destination requires an absolute rootPath']
  )
})

test('a wiki destination requires rootPath to be null', () => {
  assert.deepEqual(validateDestination(nodePathPort, wikiDest), [])
  assert.deepEqual(
    validateDestination(nodePathPort, { ...wikiDest, rootPath: '/somewhere/else' }),
    ['a wiki destination must not declare a rootPath (the configured wiki location is used)']
  )
})

test('subdir containing a ".." segment is rejected', () => {
  assert.deepEqual(validateDestination(nodePathPort, { ...folderDest, subdir: 'minutes/2026' }), [])
  assert.deepEqual(validateDestination(nodePathPort, { ...folderDest, subdir: '' }), [])
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, subdir: '../escape' }),
    ['destination subdir must not contain a ".." segment']
  )
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, subdir: 'minutes/../../escape' }),
    ['destination subdir must not contain a ".." segment']
  )
  // Windows-shaped traversal is caught by the same rule.
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, subdir: '..\\escape' }),
    ['destination subdir must not contain a ".." segment']
  )
})

test('an absolute subdir is rejected', () => {
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, subdir: '/etc' }),
    ['destination subdir must be relative, not absolute']
  )
})

test('an unrecognised store is rejected rather than ignored', () => {
  assert.deepEqual(
    validateDestination(nodePathPort, { ...folderDest, store: 'cloud' as never }),
    ['destination store must be one of: wiki, folder']
  )
})

test('an absent destination is not a validation error (complete-only forbids one)', () => {
  // "A writing behaviour needs a destination" / "complete-only forbids one"
  // are type-level rules; see test/types.test.ts.
  assert.deepEqual(validateDestination(nodePathPort, undefined), [])
  assert.deepEqual(validateDestination(nodePathPort, null), [])
})

test('a path resolving outside the root is refused', () => {
  const root = '/home/u/Documents/Minutes'
  assert.equal(isInsideRoot(nodePathPort, root, `${root}/2026-notes.md`), true)
  assert.equal(isInsideRoot(nodePathPort, root, `${root}/sub/deeper.md`), true)
  // climbing out
  assert.equal(isInsideRoot(nodePathPort, root, '/home/u/Documents/elsewhere.md'), false)
  assert.equal(isInsideRoot(nodePathPort, root, `${root}/../elsewhere.md`), false)
  // the root itself is not an artifact
  assert.equal(isInsideRoot(nodePathPort, root, root), false)
})

test('resolveDestination derives absRoot from root + subdir', () => {
  assert.deepEqual(resolveDestination(nodePathPort, wikiDest, WIKI), {
    store: 'wiki',
    root: WIKI,
    subdir: 'learning-notes',
    absRoot: `${WIKI}/learning-notes`
  })
  assert.deepEqual(resolveDestination(nodePathPort, { ...folderDest, subdir: 'minutes/2026' }, WIKI), {
    store: 'folder',
    root: '/home/u/Documents/Minutes',
    subdir: 'minutes/2026',
    absRoot: '/home/u/Documents/Minutes/minutes/2026'
  })
  // An empty subdir means the root itself.
  assert.equal(resolveDestination(nodePathPort, folderDest, WIKI).absRoot, '/home/u/Documents/Minutes')
})

test('resolveArtifact derives the filename from the title and lands inside', () => {
  const t = resolveArtifact(nodePathPort, folderDest, WIKI, 'Weekly sync: roadmap & hiring!', 't1')
  assert.equal(t.abs, '/home/u/Documents/Minutes/weekly-sync-roadmap-hiring.md')
  assert.equal(t.rel, 'weekly-sync-roadmap-hiring.md')
  assert.equal(t.inside, true)
  // A title with no usable characters still yields a safe, inside filename.
  const fallback = resolveArtifact(nodePathPort, folderDest, WIKI, '！！！', 'abcdef123456')
  assert.equal(fallback.inside, true)
  assert.ok(fallback.rel.startsWith('note-abcdef12'), `got ${fallback.rel}`)
})

test('resolveArtifact honours the wiki store for the learning default', () => {
  const t = resolveArtifact(nodePathPort, wikiDest, WIKI, 'Linear algebra review', 't1')
  assert.equal(t.absRoot, `${WIKI}/learning-notes`)
  assert.equal(t.abs, `${WIKI}/learning-notes/linear-algebra-review.md`)
  // `rel` is relative to absRoot (the confinement check's basis), so it is
  // the filename alone; the wiki-relative form is absRoot + rel.
  assert.equal(t.rel, 'linear-algebra-review.md')
  assert.equal(t.inside, true)
})

test('distinctName never reuses an existing name (FR-026)', () => {
  const taken = new Set(['minutes.md', 'minutes-2.md'])
  assert.equal(distinctName('minutes', '.md', (n) => taken.has(n)), 'minutes-3.md')
  assert.equal(distinctName('fresh', '.md', (n) => taken.has(n)), 'fresh.md')
})

test('slugify cannot produce a separator or a traversal segment', () => {
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd')
  assert.equal(slugify('a/b\\c'), 'a-b-c')
  assert.ok(!slugify('...').includes('..'))
})

test('describeDestination reads as a place a user would recognise', () => {
  assert.equal(describeDestination(folderDest), '/home/u/Documents/Minutes')
  assert.equal(describeDestination({ ...folderDest, subdir: 'minutes' }), '/home/u/Documents/Minutes/minutes')
  assert.equal(describeDestination(wikiDest), 'the wiki (learning-notes/)')
  assert.equal(describeDestination(undefined), '(none)')
})

// ---- US2: a destination change applies to subsequent finishes only (FR-005) ----

test('a destination change applies to later finishes; the earlier artifact stays untouched', async () => {
  const {
    finishWith,
    harness
  } = await import('./helpers/finishHarness')
  const { conn, dir, task, firstDir, secondDir } = harness()

  const before = await finishWith(conn, firstDir, task.id, 'file-as-is')
  const firstPath = before.result!.artifactPath!
  assert.equal(fs.readFileSync(firstPath, 'utf-8'), 'MINUTES')

  // The user re-points the type at a different folder.
  const after = await finishWith(conn, secondDir, task.id, 'file-as-is')
  const secondPath = after.result!.artifactPath!

  assert.equal(path.dirname(secondPath), secondDir, 'the new finish honours the new destination')
  assert.equal(path.dirname(firstPath), firstDir)
  // The artifact written before the change is still exactly where it was.
  assert.ok(fs.existsSync(firstPath), 'the earlier artifact was not moved')
  assert.equal(fs.readFileSync(firstPath, 'utf-8'), 'MINUTES', 'and was not rewritten')
  assert.deepEqual(fs.readdirSync(secondDir), [path.basename(secondPath)])
  conn.close()
})

test('a target override that escapes the destination refuses the finish rather than mis-saving', async () => {
  const { finishWith, harness } = await import('./helpers/finishHarness')
  const { conn, dir, task, firstDir } = harness()

  // A stored note path from a previous wiki location — the classic case.
  conn.db
    .prepare('UPDATE tasks SET inputs = ? WHERE id = ?')
    .run(JSON.stringify({ learningNotePath: path.join(dir, 'elsewhere', 'note.md') }), task.id)

  await assert.rejects(
    () => finishWith(conn, firstDir, task.id, 'file-as-is'),
    /outside the destination/,
    'a path that no longer resolves must be surfaced, never silently defaulted'
  )
  assert.deepEqual(fs.readdirSync(firstDir), [], 'nothing was written')
  conn.close()
})
