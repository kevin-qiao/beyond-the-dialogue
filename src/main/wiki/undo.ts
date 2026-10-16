import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getIngest, getTask, listTypes, updateIngest } from '../db'
import { declaredWorkflow, effectiveType } from '../../core/domain/taskType'
import { LocalizedError } from '../../core/i18n/issues'

// The curation undo (FR-020, Q3=A, research D7, T040).
//
// "Undo runs outside the job: it is a code operation on user-owned files,
// with no session and no model" (contract Jobs note). It restores exactly
// the files the run's touched-file report names, from THAT run's own
// snapshot — the retained state of the curated content as it stood before
// the curation. Because the snapshot was taken AFTER the deposit (the
// load-bearing order), the user's deposited material is never rolled back:
// raw/ is not even in the audit walk the diff reports from.
//
// Refusals carry codes (phrased at handleCommand): a run that is not `done`,
// a snapshot that is missing ("report it, do not guess"), and a collection
// that no longer resolves under the Type's destination (the same rule as at
// finish — never mis-restore into a location the user did not declare).

export type UndoOutcome =
  | { ok: true; restored: string[]; restoredState: string }
  | { ok: false; error: LocalizedError }

/** A touched-file entry must stay inside the collection: relative, no '..'. */
function isSafeRel(rel: string): boolean {
  if (!rel || path.isAbsolute(rel)) return false
  return !rel.split(/[\\/]/).includes('..')
}

export function undoCuration(db: DatabaseSync, recordId: string): UndoOutcome {
  const rec = getIngest(db, recordId)
  if (!rec) throw new Error('curation record not found')

  // Rule 1: only a completed curation can be undone — a `failed`, `undone`
  // or never-run record has no retained state to speak of (FR-020: "undo of
  // a curation that never completed is refused with a reason").
  if (rec.state !== 'done') {
    return { ok: false, error: new LocalizedError([{ key: 'undo.notDone', params: { state: rec.state } }]) }
  }

  // Rule 3 (checked before the snapshot so the reason is the most useful
  // one): the collection must still resolve under the Type's destination —
  // the same rule as at finish, so a moved or unpointed collection refuses
  // rather than restoring into a location the user did not declare.
  const task = getTask(db, rec.taskId)
  const def = task ? effectiveType(listTypes(db), task) : null
  const dest = def ? declaredWorkflow(def).destination : undefined
  const root = dest && dest.store === 'wiki' ? (dest.rootPath ?? '').trim() : ''
  if (!task || !root || !fs.existsSync(root)) {
    return { ok: false, error: new LocalizedError([{ key: 'undo.destinationUnresolved' }]) }
  }

  // Rule 2: the snapshot is the run's own retained state. Missing — never
  // recorded (a legacy row) or deleted from disk — it is reported, not
  // guessed at.
  if (!rec.snapshotDir || !isSafeRel(rec.snapshotDir)) {
    return { ok: false, error: new LocalizedError([{ key: 'undo.snapshotMissing', params: { snapshot: rec.snapshotDir ?? '(none recorded)' } }]) }
  }
  const snapAbs = path.normalize(path.join(root, rec.snapshotDir))
  if (!fs.existsSync(snapAbs) || !fs.statSync(snapAbs).isDirectory()) {
    return { ok: false, error: new LocalizedError([{ key: 'undo.snapshotMissing', params: { snapshot: rec.snapshotDir } }]) }
  }

  // Restore each touched file from the snapshot. A file the snapshot holds
  // returns to its retained content; a file the curation CREATED has no
  // snapshot copy — its retained state is absence, so it is removed. Nothing
  // outside the touched-file report is touched, and the deposit (raw/) is
  // never named by it: the audit walk the diff reports from does not cover
  // raw/, which is what makes "the deposit stands" structural.
  const restored: string[] = []
  for (const rel of rec.touchedFiles) {
    if (!isSafeRel(rel)) continue
    const cur = path.normalize(path.join(root, rel))
    const snapFile = path.normalize(path.join(snapAbs, rel))
    // Belt and braces: both ends stay inside their roots.
    if (!cur.startsWith(path.normalize(root) + path.sep) || !snapFile.startsWith(snapAbs + path.sep)) continue
    if (fs.existsSync(snapFile) && fs.statSync(snapFile).isFile()) {
      fs.mkdirSync(path.dirname(cur), { recursive: true })
      fs.copyFileSync(snapFile, cur)
      restored.push(rel)
    } else if (fs.existsSync(cur)) {
      fs.rmSync(cur)
      restored.push(rel)
    }
  }

  updateIngest(db, rec.id, { state: 'undone', undoneAt: new Date().toISOString() })
  return { ok: true, restored, restoredState: rec.snapshotDir }
}
