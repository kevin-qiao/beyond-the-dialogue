import * as fs from 'node:fs'
import * as path from 'node:path'
import { notesDir, vaultDir } from '../paths'

// The vault is the app-owned filesystem for learning artifacts. Notes are
// born as markdown files under notes/<taskId>.md (design D5: the working
// note stays app-owned; the curated note lands in the wiki on Finish).

export function ensureVault(): void {
  fs.mkdirSync(vaultDir(), { recursive: true })
  fs.mkdirSync(notesDir(), { recursive: true })
}

export function notePathFor(taskId: string): string {
  return path.join(notesDir(), `${taskId}.md`)
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
