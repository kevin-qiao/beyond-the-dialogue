import type { Attachment } from '../../shared/types'

// AttachmentStorePort — the seam for application-owned attachment copies
// (feature 001, FR-002/FR-003/FR-021).
//
// The domain decides WHAT a storable attachment is (src/core/domain/
// attachment.ts); this port is how it gets a file moved without itself
// touching a filesystem. The adapter under src/main/adapters owns the bytes.
//
// `copyIn` takes the source path only for the duration of the copy: the
// stored value is the data-root-relative path the adapter computed, never
// the source path (that would break the folder-copy promise).

export interface AttachmentStorePort {
  /**
   * Copy the file at `sourcePath` in, store it at
   * `attachments/<attachment-id>/<name>`, and record the row.
   * Refuses (throws a code-carrying error) when the size cap or readability
   * rules reject the source — the task is left intact either way.
   */
  copyIn(taskId: string, sourcePath: string): Attachment
  /** Remove one attachment: row and stored file together. */
  remove(attachmentId: string): void
  /** Remove every attachment of a task: rows and files (deletion is final). */
  purgeForTask(taskId: string): void
  /** The stored file's absolute path for opening, or null when it is missing. */
  resolveStored(attachmentId: string): { attachment: Attachment; absPath: string } | null
}
