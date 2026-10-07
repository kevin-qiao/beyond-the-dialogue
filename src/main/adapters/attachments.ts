import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Attachment } from '../../shared/types'
import type { AttachmentStorePort } from '../../core/ports/attachments'
import { MAX_ATTACHMENT_BYTES, checkAttachment, storedRelativePath } from '../../core/domain/attachment'
import { LocalizedError } from '../../core/i18n/issues'
import { createAttachment, deleteAttachmentRow, getAttachment, listAttachments } from '../db'
import { userDataDir } from '../paths'

// The AttachmentStorePort implementation (feature 001, research D2).
//
// Files are copied IN at add time and become the application's own
// (FR-003): moving, renaming, or deleting the original never breaks the
// task. The stored value is the path RELATIVE to the data-folder root, so
// the folder-copy portability promise (FR-021) holds for attachments too —
// the absolute source path is used for the duration of the copy and never
// persisted.
//
// Electron stays out of this module: `openPath` is what the IPC handler does
// with the resolved absolute path (src/main/index.ts), which keeps the copy
// machinery testable headless (Principle IV).

/** A minimal display-MIME guess by extension; absence is not a refusal. */
const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function guessMime(name: string): string | null {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? null
}

export function createAttachmentStore(db: DatabaseSync): AttachmentStorePort {
  return {
    copyIn(taskId: string, sourcePath: string): Attachment {
      // Readability then size — the two refusals the data-model names, each
      // stated with its reason. The task is not touched on refusal.
      let stat: fs.Stats
      try {
        stat = fs.statSync(sourcePath)
        if (!stat.isFile()) throw new Error('not a file')
        fs.accessSync(sourcePath, fs.constants.R_OK)
      } catch {
        throw new LocalizedError([{ key: 'attachment.unreadable' }])
      }
      const issues = checkAttachment({ size: stat.size, readable: true })
      if (issues.length > 0) throw new LocalizedError(issues)

      const id = randomUUID()
      const rel = storedRelativePath(id, sourcePath)
      if (rel === null) throw new LocalizedError([{ key: 'attachment.unreadable' }])

      const abs = path.join(userDataDir(), rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      try {
        fs.copyFileSync(sourcePath, abs)
      } catch {
        // A half-written directory must not survive the refusal.
        try {
          fs.rmSync(path.dirname(abs), { recursive: true, force: true })
        } catch {
          // ignore — nothing points at it any more
        }
        throw new LocalizedError([{ key: 'attachment.unreadable' }])
      }

      const name = path.basename(sourcePath)
      return createAttachment(db, {
        id,
        taskId,
        name,
        mime: guessMime(name),
        path: rel,
        size: Math.min(stat.size, MAX_ATTACHMENT_BYTES + 1)
      })
    },

    remove(attachmentId: string): void {
      const row = deleteAttachmentRow(db, attachmentId)
      if (!row) return
      purgeFile(row)
    },

    purgeForTask(taskId: string): void {
      for (const a of listAttachments(db, taskId)) {
        deleteAttachmentRow(db, a.id)
        purgeFile(a)
      }
    },

    resolveStored(attachmentId: string): { attachment: Attachment; absPath: string } | null {
      const row = getAttachment(db, attachmentId)
      if (!row) return null
      const abs = path.join(userDataDir(), row.path)
      if (!fs.existsSync(abs)) return null
      return { attachment: row, absPath: abs }
    }
  }
}

function purgeFile(a: Attachment): void {
  // The whole attachment directory (id owns it), so no orphan dir is left.
  try {
    fs.rmSync(path.join(userDataDir(), `attachments/${a.id}`), { recursive: true, force: true })
  } catch {
    // A file that cannot be removed does not undo the deletion: the row is
    // gone and the bytes are unreachable garbage on disk (deletion is final).
  }
}
