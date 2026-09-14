import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getTask, getPreprocess, getNotes, loadSettings } from '../db'
import { defaultWikiPath } from '../paths'
import { depositInto } from '../adapters/artifacts/deposit'
import { slugify } from '../../core/domain/slug'
import type { TaskPreprocess } from '../../shared/types'

// LLM-WiKi integration: scaffolding, deposit-first safety net, .history
// snapshots, and the confined ingestion agent (design D5/D7).

// The LLM-WiKi pattern guide lives as a markdown template (src/main/wiki/
// LLM-WiKi.md) and is seeded into every created wiki. It is read from disk at
// runtime so the same file serves tests/dev (repo checkout) and packaged
// builds (electron-builder extraResources copies it next to the app).
function wikiGuideMarkdown(): string | null {
  const candidates = [
    process.env.WORKBOARD_WIKI_GUIDE,
    path.resolve(process.cwd(), 'src', 'main', 'wiki', 'LLM-WiKi.md'),
    typeof process.resourcesPath === 'string' ? path.join(process.resourcesPath, 'LLM-WiKi.md') : undefined
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf-8')
    } catch {
      // unreadable candidate — try the next one
    }
  }
  return null
}

export function resolveWikiPath(configured: string): string {
  if (configured && configured.trim()) return configured.trim()
  return defaultWikiPath()
}

// Wiki scaffolding, create-only. It creates `learning-notes/` because that
// directory is part of the *wiki's* own shape — the wiki schema this function
// writes into CLAUDE.md documents it, and the learning flow writes there by
// default. Scaffolding is therefore scoped to the destination that is actually
// a wiki: the folder store never calls this, so a meeting-minutes folder is
// never restructured into a wiki (contracts/destination.md §3).
export function ensureWikiDir(wikiPath: string): void {
  fs.mkdirSync(path.join(wikiPath, 'raw'), { recursive: true })
  fs.mkdirSync(path.join(wikiPath, 'wiki'), { recursive: true })
  fs.mkdirSync(path.join(wikiPath, 'learning-notes'), { recursive: true })
  fs.mkdirSync(path.join(wikiPath, '.history'), { recursive: true })
  if (!fs.existsSync(path.join(wikiPath, 'index.md'))) {
    fs.writeFileSync(path.join(wikiPath, 'index.md'), '# Wiki Index\n\n## Sources\n\n- (empty)\n\n## Entities\n\n- (empty)\n', 'utf-8')
  }
  if (!fs.existsSync(path.join(wikiPath, 'log.md'))) {
    fs.writeFileSync(path.join(wikiPath, 'log.md'), '# Activity Log\n\n', 'utf-8')
  }
  if (!fs.existsSync(path.join(wikiPath, 'CLAUDE.md'))) {
    fs.writeFileSync(path.join(wikiPath, 'CLAUDE.md'), WIKI_SCHEMA, 'utf-8')
  }
  // Seed the pattern guide once; missing template must not break scaffolding.
  const guidePath = path.join(wikiPath, 'LLM-WiKi.md')
  if (!fs.existsSync(guidePath)) {
    const guide = wikiGuideMarkdown()
    if (guide != null) fs.writeFileSync(guidePath, guide, 'utf-8')
  }
}

// Never overwrite existing structures: scaffolding is create-only.
export function scaffoldWikiIfNeeded(wikiPath: string): boolean {
  const existed = fs.existsSync(path.join(wikiPath, 'index.md')) || fs.existsSync(path.join(wikiPath, 'CLAUDE.md'))
  ensureWikiDir(wikiPath)
  return existed
}

const WIKI_SCHEMA = `# LLM-WiKi Schema & Ingestion Workflow

You are the maintainer of a personal knowledge wiki. When asked to ingest a finished learning note, follow this workflow exactly.

## Structure

- \`raw/\` — immutable source material (the finished note, its AI summary, optional attachments). Never modify files here.
- \`wiki/\` — your authored pages (entity pages, concept pages, cross-links).
- \`learning-notes/\` — curated learning notes, one markdown file per finished task.
- \`index.md\` — content catalog: every page listed with a link, a one-line summary, grouped by category (Sources, Entities, Concepts).
- \`log.md\` — append-only chronological record. Each entry starts with \`## [YYYY-MM-DD] ingest | Title\`.

## Conventions

- The curated note for an ingestion is written at the **learning-note path** given in the ingest request (default \`learning-notes/<slug>.md\`, \`<slug>\` a short kebab-case title). If a file already exists at that path, update and merge into it rather than duplicating.
- A curated learning note starts with a 1-3 line overview, then the note's own sections; end it with a \`## Sources\` line linking the raw deposit folder.
- Create or update related entity/concept pages in \`wiki/entities/\` and \`wiki/concepts/\` when the note introduces them.
- Keep cross-references: link the note from index.md, and link related pages to each other.
- Never modify anything under \`raw/\`.

## Ingestion workflow

1. Read the raw deposit in \`raw/\` for the given task folder (note + AI summary + optional attachment).
2. Write or update the curated learning note at the given learning-note path.
3. Update or create related entity/concept pages under \`wiki/\` if applicable.
4. Update \`index.md\` to include the new/updated pages.
5. Append an entry to \`log.md\` with the convention above.

You have read/write/edit/grep/find/ls tools only — never run shell commands. Work only inside this wiki directory.
`

// ---- learning-note path helpers (design D5) ----

// Filename derivation now lives in the core domain (src/core/domain/slug.ts)
// so the destination mechanism and the wiki share one implementation.
// Re-exported here because this is where callers and tests have always found it.
export { slugify }

// Resolve the learning-note path for a task against the current wiki. The
// stored value may be relative (normal case) or absolute (user typed it).
// Returns the absolute + wiki-relative paths and whether it lands inside
// the wiki at all (a changed wiki can orphan old paths — surfaced as a
// mismatch, never silently mis-saved).
export function resolveLearningNotePath(
  wikiPath: string,
  stored: unknown,
  title: string,
  taskId: string
): { abs: string; rel: string; insideWiki: boolean } {
  const raw = typeof stored === 'string' && stored.trim() ? stored.trim() : path.posix.join('learning-notes', `${slugify(title, taskId)}.md`)
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(wikiPath, raw))
  const rel = path.relative(wikiPath, abs)
  const insideWiki = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  return { abs, rel: insideWiki ? rel.split(path.sep).join('/') : '', insideWiki }
}

export interface DepositResult {
  rawDir: string
  files: string[]
}

// Deposit step (spec learning-type: deposit-first safety net): synchronous
// file copies into raw/<taskId>/ — the finished note under a generated name
// deduped on collision, plus the AI pre-process summary and the optional
// attachment. Plain copies; succeeds before any ingest work begins.
export function depositTask(db: DatabaseSync, taskId: string): DepositResult {
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')
  const wikiPath = resolveWikiPath(loadSettings(db).wikiPath)
  // Create-only scaffolding first: the deposit and the curating agent both
  // need the wiki's structure (schema file, index, log) to exist.
  ensureWikiDir(wikiPath)
  const rawDir = path.join(wikiPath, 'raw', taskId)

  const note = getNotes(db, taskId)
  const preprocess = getPreprocess(db, taskId)
  const filePath = typeof task.inputs.filePath === 'string' ? task.inputs.filePath : ''
  const result = depositInto(rawDir, {
    taskId,
    title: task.title,
    content: note?.content ?? '',
    summary: preprocess ? renderPreprocessSummary(task.title, preprocess) : undefined,
    attachmentPath: filePath || undefined
  })
  return { rawDir: result.dir, files: result.files }
}

function renderPreprocessSummary(title: string, p: TaskPreprocess): string {
  return `# AI Pre-process Summary — ${title}

## Summary
${p.summary || '(none)'}

## Analysis
${p.analysis || '(none)'}

## Activity suggestions
${p.suggestions.map((s) => `- ${s}`).join('\n') || '(none)'}
`
}

// Which directories the audit walk covers.
//
// `wiki/` always holds the agent's authored pages. The destination's own
// subdir is added on top of it: the walk used to be the hardcoded pair
// ['wiki','learning-notes'], which made ANY other destination directory
// invisible to snapshot and diff. That failure mode is worse than an error —
// every finish would still report success while the audit trail stayed
// silently empty, and nothing would signal it.
function auditDirs(destSubdir?: string): string[] {
  const dirs = ['wiki']
  const sub = (destSubdir ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!sub) {
    // Caller did not name a destination: keep the historical default so the
    // wiki's own tests and the learning flow are unchanged.
    dirs.push('learning-notes')
  } else if (sub !== 'wiki' && !sub.startsWith('..') && !path.isAbsolute(sub)) {
    dirs.push(sub)
  }
  return dirs
}

// Snapshot existing files before ingestion. Returns list of (path, backup).
export function snapshotWikiFiles(wikiPath: string, filesToProtect: string[], destSubdir?: string): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const histDir = path.join(wikiPath, '.history', stamp)
  fs.mkdirSync(histDir, { recursive: true })
  const protectedFiles = filesToProtect.length
    ? filesToProtect
    : listExistingWikiFiles(wikiPath, destSubdir)
  const touched: string[] = []
  for (const rel of protectedFiles) {
    const src = path.join(wikiPath, rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(histDir, rel.replace(/^\.?\//, ''))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    touched.push(rel)
  }
  return touched
}

export function listExistingWikiFiles(wikiPath: string, destSubdir?: string): string[] {
  const out: string[] = []
  const walk = (dir: string, base: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.history') continue
      const full = path.join(dir, entry.name)
      const rel = path.posix.join(base, entry.name)
      if (entry.isDirectory()) walk(full, rel)
      else out.push(rel)
    }
  }
  for (const dirName of auditDirs(destSubdir)) {
    if (fs.existsSync(path.join(wikiPath, dirName))) walk(path.join(wikiPath, dirName), dirName)
  }
  if (fs.existsSync(path.join(wikiPath, 'index.md'))) out.push('index.md')
  if (fs.existsSync(path.join(wikiPath, 'log.md'))) out.push('log.md')
  return out
}

// Diff current wiki files against the most recent .history snapshot to report
// which files the ingestion actually modified (or newly created).
export function diffTouchedFiles(wikiPath: string, destSubdir?: string): string[] {
  const histDir = path.join(wikiPath, '.history')
  const stamps = fs.existsSync(histDir) ? fs.readdirSync(histDir).sort() : []
  if (stamps.length === 0) return []
  const base = path.join(histDir, stamps.at(-1)!)
  const before = new Map<string, string>()
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? path.posix.join(prefix, entry.name) : entry.name
      if (entry.isDirectory()) walk(full, rel)
      else before.set(rel, fs.readFileSync(full, 'utf-8'))
    }
  }
  if (fs.existsSync(base)) walk(base, '')
  const touched: string[] = []
  for (const rel of listExistingWikiFiles(wikiPath, destSubdir)) {
    const cur = path.join(wikiPath, rel)
    if (!fs.existsSync(cur)) continue
    const beforeContent = before.get(rel)
    const curContent = fs.readFileSync(cur, 'utf-8')
    if (beforeContent === undefined || beforeContent !== curContent) touched.push(rel)
  }
  return touched
}
