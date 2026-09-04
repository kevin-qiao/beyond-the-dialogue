import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getTask, getAnalysis, getNotes, loadSettings } from './db'
import { defaultWikiPath } from './paths'
import { summaryPathFor, notePathFor, pdfPathFor } from './vault'

// LLM-WiKi integration: scaffolding, deposit-first safety net, .history
// snapshots, and the confined ingestion agent.

export function resolveWikiPath(configured: string): string {
  if (configured && configured.trim()) return configured.trim()
  return defaultWikiPath()
}

export function ensureWikiDir(wikiPath: string): void {
  fs.mkdirSync(path.join(wikiPath, 'raw'), { recursive: true })
  fs.mkdirSync(path.join(wikiPath, 'wiki'), { recursive: true })
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
}

// Never overwrite existing structures: scaffolding is create-only.
export function scaffoldWikiIfNeeded(wikiPath: string): boolean {
  const existed = fs.existsSync(path.join(wikiPath, 'index.md')) || fs.existsSync(path.join(wikiPath, 'CLAUDE.md'))
  ensureWikiDir(wikiPath)
  return existed
}

const WIKI_SCHEMA = `# LLM-WiKi Schema & Ingestion Workflow

You are the maintainer of a personal knowledge wiki. When asked to ingest a source, follow this workflow exactly.

## Structure

- \`raw/\` — immutable source material (notes, summaries, PDFs). Never modify files here.
- \`wiki/\` — your authored pages (summaries, entity pages, concept pages).
- \`index.md\` — content catalog: every page listed with a link, a one-line summary, grouped by category (Sources, Entities, Concepts).
- \`log.md\` — append-only chronological record. Each entry starts with \`## [YYYY-MM-DD] ingest | Title\`.

## Conventions

- One source summary page per paper, named \`wiki/sources/<slug>.md\` where \`<slug>\` is a short kebab-case title.
- A source summary page starts with a 1-3 line overview, then sections: TLDR, Contributions, Method, Results, Prerequisites, Reading Notes.
- Update or create related entity/concept pages in \`wiki/entities/\` and \`wiki/concepts/\` when a source introduces them.
- Keep cross-references: link the source page from index.md under Sources, and link related pages to each other.
- Never modify anything under \`raw/\`.

## Ingestion workflow

1. Read the raw deposit in \`raw/\` (note + summary + optional PDF).
2. Write the source summary page under \`wiki/sources/\`.
3. Update \`index.md\` to include the new page (and any new entity/concept pages).
4. Update related entity/concept pages if applicable.
5. Append an entry to \`log.md\` with the convention above.

You have read/write/edit/grep/find/ls tools only — never run shell commands. Work only inside this wiki directory.
`

export interface DepositResult {
  rawDir: string
  files: string[]
}

// Deposit step: synchronous file copy of note + summary (+ PDF) into raw/.
export function depositTask(db: DatabaseSync, taskId: string): DepositResult {
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')
  const wikiPath = resolveWikiPath(loadSettings(db).wikiPath)
  ensureWikiDir(wikiPath)
  const rawDir = path.join(wikiPath, 'raw', taskId)
  fs.mkdirSync(rawDir, { recursive: true })
  const files: string[] = []

  const note = getNotes(db, taskId)
  if (note && note.content.trim()) {
    const dest = path.join(rawDir, 'reading-notes.md')
    fs.copyFileSync(note.notePath, dest)
    files.push('reading-notes.md')
  }

  const analysis = getAnalysis(db, taskId)
  if (analysis) {
    const summary = renderSummary(analysis)
    const dest = path.join(rawDir, 'analysis-summary.md')
    fs.writeFileSync(dest, summary, 'utf-8')
    files.push('analysis-summary.md')
  }

  const pdf = pdfPathFor(taskId)
  if (fs.existsSync(pdf)) {
    const dest = path.join(rawDir, 'paper.pdf')
    fs.copyFileSync(pdf, dest)
    files.push('paper.pdf')
  }

  return { rawDir, files }
}

function renderSummary(a: ReturnType<typeof getAnalysis>): string {
  if (!a) return ''
  return `# Analysis Summary

## TLDR
${a.tldr}

## Contributions
${a.contributions.map((c) => `- ${c}`).join('\n')}

## Method
${a.method}

## Results
${a.results}

## Prerequisites
${a.prerequisites.map((p) => `- ${p}`).join('\n')}

## Reading Suggestions
${a.suggestions.map((s) => `### ${s.title}\n${s.body}`).join('\n\n')}
`
}

// Snapshot existing files before ingestion. Returns list of (path, backup).
export function snapshotWikiFiles(wikiPath: string, filesToProtect: string[]): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const histDir = path.join(wikiPath, '.history', stamp)
  fs.mkdirSync(histDir, { recursive: true })
  const protectedFiles = filesToProtect.length
    ? filesToProtect
    : listExistingWikiFiles(wikiPath)
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

function listExistingWikiFiles(wikiPath: string): string[] {
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
  if (fs.existsSync(path.join(wikiPath, 'wiki'))) walk(path.join(wikiPath, 'wiki'), 'wiki')
  if (fs.existsSync(path.join(wikiPath, 'index.md'))) out.push('index.md')
  if (fs.existsSync(path.join(wikiPath, 'log.md'))) out.push('log.md')
  return out
}

// Diff current wiki files against the most recent .history snapshot to report
// which files the ingestion actually modified (or newly created).
export function diffTouchedFiles(wikiPath: string): string[] {
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
  for (const rel of listExistingWikiFiles(wikiPath)) {
    const cur = path.join(wikiPath, rel)
    if (!fs.existsSync(cur)) continue
    const beforeContent = before.get(rel)
    const curContent = fs.readFileSync(cur, 'utf-8')
    if (beforeContent === undefined || beforeContent !== curContent) touched.push(rel)
  }
  return touched
}
