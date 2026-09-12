import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DepositParts, DepositResult } from '../../../core/ports/artifactStore'
import { distinctName, slugify } from '../../../core/domain/slug'

// Deposit-first safety net, shared by both artifact stores (design D7).
//
// The deposit is a synchronous file copy that succeeds before any curating work
// begins, so the user's material survives a later failure of the assistant
// step. Both stores write the same shape — the note under a title-derived
// deduped name, plus the AI summary and the optional attachment — differing
// only in which directory counts as the raw area.

export function depositInto(rawDir: string, parts: DepositParts, ext = '.md'): DepositResult {
  fs.mkdirSync(rawDir, { recursive: true })
  // Only ever ADD to an existing raw area; a previous deposit is never
  // overwritten or relocated.
  if (parts.content.trim()) {
    const existing = new Set(fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [])
    const name = distinctName(slugify(parts.title, parts.taskId), ext, (n) => existing.has(n))
    fs.writeFileSync(path.join(rawDir, name), parts.content, 'utf-8')
  }
  if (parts.summary !== undefined) {
    fs.writeFileSync(path.join(rawDir, 'ai-summary.md'), parts.summary, 'utf-8')
  }
  if (parts.attachmentPath && fs.existsSync(parts.attachmentPath)) {
    fs.copyFileSync(parts.attachmentPath, path.join(rawDir, `attachment-${path.basename(parts.attachmentPath)}`))
  }
  return { dir: rawDir, files: fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [] }
}
