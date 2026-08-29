import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { classifyLink } from '../src/main/paper/resolve'
import { ensureWikiDir, resolveWikiPath, depositTask, snapshotWikiFiles } from '../src/main/wiki'
import { openDB, migrate, createList, createTask, saveAnalysis, saveNotes, listLists, listIngest, saveSettings } from '../src/main/db'
import { setUserDataRoot } from '../src/main/paths'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'))
}

test('5.2 link classifier recognizes arXiv, DOI, meta, unknown', () => {
  assert.deepEqual(classifyLink('https://arxiv.org/abs/2301.00001'), { type: 'arxiv', id: '2301.00001' })
  assert.deepEqual(classifyLink('https://arxiv.org/pdf/2301.00001v2'), { type: 'arxiv', id: '2301.00001v2' })
  assert.deepEqual(classifyLink('2301.00001'), { type: 'arxiv', id: '2301.00001' })
  assert.deepEqual(classifyLink('https://doi.org/10.1038/s41586-024-00000-0'), {
    type: 'doi',
    id: '10.1038/s41586-024-00000-0'
  })
  assert.equal(classifyLink('10.1038/s41586-024-00000-0').type, 'doi')
  assert.equal(classifyLink('https://publisher.org/paper').type, 'meta')
  assert.equal(classifyLink('not a link').type, 'unknown')
})

test('6.1-6.2 wiki scaffolding creates structure and never overwrites', () => {
  const dir = tmpdir()
  ensureWikiDir(dir)
  for (const rel of ['raw', 'wiki', '.history', 'index.md', 'log.md', 'CLAUDE.md']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`)
  }
  const indexContent = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8')
  // Existing structure is reused, not overwritten
  fs.writeFileSync(path.join(dir, 'index.md'), '# CUSTOM INDEX')
  ensureWikiDir(dir)
  assert.equal(fs.readFileSync(path.join(dir, 'index.md'), 'utf-8'), '# CUSTOM INDEX')
  assert.ok(indexContent.includes('Wiki Index'))
})

test('6.3 deposit writes note + summary into raw/', () => {
  const dir = tmpdir()
  const wikiPath = path.join(dir, 'wiki-space')
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, { provider: 'openai', model: '', apiKey: null, wikiPath, defaultListId: null, maxConcurrentJobs: 2 })
  const l = listLists(conn.db)[0]!
  const t = createTask(conn.db, { listId: l.id, title: 'p', type: 'paper_reading' })
  saveNotes(conn.db, { taskId: t.id, notePath: path.join(dir, 'note.md'), content: '# my note' })
  fs.writeFileSync(path.join(dir, 'note.md'), '# my note')
  saveAnalysis(conn.db, {
    taskId: t.id,
    level: 'full',
    status: 'ready',
    tldr: 't',
    contributions: ['a'],
    method: 'm',
    results: 'r',
    prerequisites: [],
    suggestions: []
  })
  const deposit = depositTask(conn.db, t.id)
  assert.ok(deposit.rawDir.startsWith(wikiPath))
  assert.ok(deposit.files.includes('reading-notes.md'))
  assert.ok(deposit.files.includes('analysis-summary.md'))
  const noteDest = path.join(deposit.rawDir, 'reading-notes.md')
  assert.ok(fs.existsSync(noteDest))
  assert.equal(fs.readFileSync(noteDest, 'utf-8'), '# my note')
})

test('6.4 snapshot preserves prior contents of wiki files', () => {
  const dir = tmpdir()
  ensureWikiDir(dir)
  fs.mkdirSync(path.join(dir, 'wiki', 'sources'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.md'), 'OLD INDEX')
  fs.writeFileSync(path.join(dir, 'wiki', 'sources', 'x.md'), 'OLD PAGE')
  const touched = snapshotWikiFiles(dir, ['index.md', 'wiki/sources/x.md'])
  assert.ok(touched.includes('index.md'))
  // find the newest .history dir and verify contents
  const hist = fs.readdirSync(path.join(dir, '.history'))
  assert.ok(hist.length > 0)
  const newest = path.join(dir, '.history', hist.sort().at(-1)!)
  assert.ok(fs.existsSync(path.join(newest, 'index.md')))
  assert.equal(fs.readFileSync(path.join(newest, 'index.md'), 'utf-8'), 'OLD INDEX')
})

test('resolveWikiPath defaults to documents location when unset', () => {
  const p = resolveWikiPath('')
  assert.ok(p.endsWith('WorkBoard-Wiki'))
  assert.equal(resolveWikiPath('/custom/w'), '/custom/w')
})
