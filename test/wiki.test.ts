import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ensureWikiDir, resolveWikiPath, depositTask, snapshotWikiFiles, diffTouchedFiles, slugify, resolveLearningNotePath } from '../src/main/wiki/wiki'
import { openDB, migrate, createList, createTask, savePreprocess, saveNotes, listLists, saveSettings } from '../src/main/db'
import { setUserDataRoot } from '../src/main/paths'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'))
}

test('6.1-6.2 wiki scaffolding creates structure and never overwrites', () => {
  const dir = tmpdir()
  ensureWikiDir(dir)
  for (const rel of ['raw', 'wiki', 'learning-notes', '.history', 'index.md', 'log.md', 'CLAUDE.md', 'LLM-WiKi.md']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`)
  }
  const indexContent = fs.readFileSync(path.join(dir, 'index.md'), 'utf-8')
  assert.ok(indexContent.includes('Wiki Index'))
  // The scaffold schema speaks learning notes, not papers (v0.8 wording).
  const schema = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')
  assert.ok(schema.includes('learning note'), 'schema generalized to learning notes')
  assert.ok(!/\bpaper\b/i.test(schema), 'no paper vocabulary in fresh schema')
  // The LLM-WiKi pattern guide is seeded from the bundled template.
  const guideContent = fs.readFileSync(path.join(dir, 'LLM-WiKi.md'), 'utf-8')
  assert.ok(guideContent.includes('# LLM Wiki'))
  // Existing structure is reused, not overwritten
  fs.writeFileSync(path.join(dir, 'index.md'), '# CUSTOM INDEX')
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# CUSTOM SCHEMA')
  ensureWikiDir(dir)
  assert.equal(fs.readFileSync(path.join(dir, 'index.md'), 'utf-8'), '# CUSTOM INDEX')
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8'), '# CUSTOM SCHEMA')
})

test('6.3 deposit writes note + AI summary into raw/ under a title-derived name', () => {
  const dir = tmpdir()
  const wikiPath = path.join(dir, 'wiki-space')
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, { provider: 'openai', model: '', apiKey: null, wikiPath, defaultListId: null, maxConcurrentJobs: 2, showWelcome: false, theme: 'light', skills: [], mcpServers: [] })
  const l = listLists(conn.db)[0]!
  const t = createTask(conn.db, { listId: l.id, title: 'Linear algebra review', type: 'learning', inputs: { target: 'eigenvalues' } })
  const noteFile = path.join(dir, 'note.md')
  fs.writeFileSync(noteFile, '# my note')
  saveNotes(conn.db, { taskId: t.id, notePath: noteFile, content: '# my note' })
  savePreprocess(conn.db, { taskId: t.id, kind: 'learning', summary: 'A summary.', analysis: 'Review eigenvalues.', suggestions: ['s'], generatedPrompt: 'p', status: 'ready', inputsHash: 'h' })
  const deposit = depositTask(conn.db, t.id)
  assert.ok(deposit.rawDir.startsWith(wikiPath))
  assert.ok(deposit.files.includes('linear-algebra-review.md'), `got ${deposit.files}`)
  assert.ok(deposit.files.includes('ai-summary.md'))
  const noteDest = path.join(deposit.rawDir, 'linear-algebra-review.md')
  assert.ok(fs.existsSync(noteDest))
  assert.equal(fs.readFileSync(noteDest, 'utf-8'), '# my note')

  // Duplicate titles disambiguate without overwriting (spec learning-type).
  fs.writeFileSync(noteDest, 'KEEP ME')
  const again = depositTask(conn.db, t.id)
  assert.ok(again.files.includes('linear-algebra-review-2.md'), `got ${again.files}`)
  assert.equal(fs.readFileSync(noteDest, 'utf-8'), 'KEEP ME', 'first deposit untouched')
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

test('slugify derives safe filenames', () => {
  assert.equal(slugify('Linear algebra review'), 'linear-algebra-review')
  assert.equal(slugify('  NFTrig: Blockchain & Math!!  '), 'nftrig-blockchain-math')
  assert.ok(slugify('！！！').startsWith('note-'), 'non-latin titles fall back to a token')
})

test('learning-note path resolves inside the wiki by default and flags escapes', () => {
  const wiki = '/home/u/Documents/WorkBoard-Wiki'
  const def = resolveLearningNotePath(wiki, undefined, 'Linear algebra review', 't1')
  assert.equal(def.insideWiki, true)
  assert.equal(def.rel, 'learning-notes/linear-algebra-review.md')
  const relative = resolveLearningNotePath(wiki, 'notes/custom-note.md', 'x', 't1')
  assert.equal(relative.rel, 'notes/custom-note.md')
  assert.equal(relative.insideWiki, true)
  // An absolute path under the wiki still resolves inside.
  const insideAbs = resolveLearningNotePath(wiki, `${wiki}/learning-notes/a.md`, 'x', 't1')
  assert.equal(insideAbs.insideWiki, true)
  // An old path from a previous wiki location is flagged, not silently used.
  const escaped = resolveLearningNotePath('/new/wiki', '/old/wiki/learning-notes/a.md', 'x', 't1')
  assert.equal(escaped.insideWiki, false)
})

test('6.8 diffTouchedFiles reports modified and new files since last snapshot', () => {
  const dir = tmpdir()
  ensureWikiDir(dir)
  fs.mkdirSync(path.join(dir, 'wiki', 'sources'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.md'), 'OLD INDEX')
  snapshotWikiFiles(dir, ['index.md'])
  // agent modifies index.md and creates a new page
  fs.writeFileSync(path.join(dir, 'index.md'), 'NEW INDEX')
  fs.writeFileSync(path.join(dir, 'wiki', 'sources', 'new-note.md'), '# New summary')
  const touched = diffTouchedFiles(dir)
  assert.ok(touched.includes('index.md'), `index.md touched, got ${touched}`)
  assert.ok(touched.includes('wiki/sources/new-note.md'), `new page touched, got ${touched}`)
})
