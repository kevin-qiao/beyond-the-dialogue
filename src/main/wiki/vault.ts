import * as fs from 'node:fs'
import * as path from 'node:path'
import { analysesDir, notesDir, pdfsDir, vaultDir } from '../paths'

// The vault is the app-owned filesystem for learning artifacts. Notes are
// born as markdown files; analyses and PDFs are stored per task.

export function ensureVault(): void {
  fs.mkdirSync(vaultDir(), { recursive: true })
  fs.mkdirSync(notesDir(), { recursive: true })
  fs.mkdirSync(analysesDir(), { recursive: true })
  fs.mkdirSync(pdfsDir(), { recursive: true })
}

export function notePathFor(taskId: string): string {
  return path.join(notesDir(), `${taskId}.md`)
}

export function analysisDirFor(taskId: string): string {
  const dir = path.join(analysesDir(), taskId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function jobWorkspaceFor(taskId: string): string {
  const dir = path.join(analysisDirFor(taskId), 'workspace')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function summaryPathFor(taskId: string): string {
  return path.join(analysisDirFor(taskId), 'summary.md')
}

export function suggestionsPathFor(taskId: string): string {
  return path.join(analysisDirFor(taskId), 'suggestions.json')
}

export function pdfPathFor(taskId: string): string {
  return path.join(pdfsDir(), `${taskId}.pdf`)
}

export function readNote(taskId: string): string {
  const p = notePathFor(taskId)
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf-8')
}

export function writeNote(taskId: string, content: string): void {
  ensureVault()
  fs.writeFileSync(notePathFor(taskId), content, 'utf-8')
}

export function writeAnalysisFiles(taskId: string, summary: string, suggestionsJson: string): void {
  ensureVault()
  const dir = analysisDirFor(taskId)
  fs.writeFileSync(path.join(dir, 'summary.md'), summary, 'utf-8')
  fs.writeFileSync(path.join(dir, 'suggestions.json'), suggestionsJson, 'utf-8')
}

export function storePdf(taskId: string, sourcePath: string): string {
  ensureVault()
  const dest = pdfPathFor(taskId)
  fs.copyFileSync(sourcePath, dest)
  return dest
}
