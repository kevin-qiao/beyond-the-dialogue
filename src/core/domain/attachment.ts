import type { MessageIssue } from '../i18n/issues'

// The pure rules behind the attachment feature (feature 001, research D2,
// FR-002/FR-003/FR-021). Copying, dialogs and file I/O live behind the port
// `src/core/ports/attachments.ts`, implemented under `src/main/adapters/`;
// everything that decides WHAT counts as a storable attachment lives here,
// where a headless test can reach it.

/**
 * The plan left the per-file cap to the tasks phase ("a generous size guard");
 * it is fixed here at 50 MiB. Large media is out of spirit (spec Assumptions),
 * and the cap is stated in the refusal, so a rejection never reads as a
 * mystery failure.
 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** The cap as the user reads it, phrased through the refusal's `{limit}`. */
export const MAX_ATTACHMENT_LABEL = '50 MiB'

/**
 * Can this file become an attachment? A refusal carries codes (the domain has
 * no language); the stated reason surfaces in the toast. The task itself is
 * untouched either way — "the task keeps its other content" (data-model).
 */
export function checkAttachment(args: { size: number; readable: boolean }): MessageIssue[] {
  if (!args.readable) return [{ key: 'attachment.unreadable' }]
  if (args.size > MAX_ATTACHMENT_BYTES) {
    return [{ key: 'attachment.tooLarge', params: { limit: MAX_ATTACHMENT_LABEL } }]
  }
  return []
}

/**
 * The stored location of an attachment, RELATIVE to the data-folder root, or
 * `null` when the name cannot be made relative — a name that is absolute,
 * empty, or a directory escape. FR-021 is a folder-copy promise: an absolute
 * path anywhere in the board store breaks it silently, so the rule refuses
 * here rather than storing a path that dies on the move.
 *
 * Purely string-shaped on purpose: `src/core` performs no I/O and may not
 * import `node:path`.
 */
export function storedRelativePath(attachmentId: string, name: string): string | null {
  if (!attachmentId.trim()) return null
  // The last path segment, whichever separator the source machine used.
  const base = name.split(/[\\/]/).pop() ?? ''
  if (!base || base === '.' || base === '..') return null
  // A drive-relative name (`C:notes.txt`) has no separator to strip, and a
  // colon is not legal in a filename on Windows — both target platforms must
  // be able to open the stored copy (FR-018), so it is refused, not stored.
  if (base.includes(':')) return null
  return `attachments/${attachmentId}/${base}`
}

/** Is a stored value a data-root-relative path? The portability scan uses this. */
export function isRelativeStoredPath(stored: string): boolean {
  if (!stored) return false
  if (stored.startsWith('/') || stored.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(stored)) return false
  return !stored.split(/[\\/]/).includes('..')
}
