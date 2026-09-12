// Filename derivation for finished artifacts. Pure string work — no path
// primitives — which is why it lives in core rather than next to the file I/O.
//
// The slug is constrained to [a-z0-9-] and 60 characters, so it cannot contain
// a path separator or a `..` segment; filename derivation can therefore never
// be the thing that escapes a destination root.

/**
 * Kebab-case slug from a task title, safe as a filename. Falls back to a
 * task-id fragment when the title has no usable characters.
 */
export function slugify(title: string, taskId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  if (slug.length >= 2) return slug
  return `note-${(taskId ?? '').slice(0, 8) || randomToken()}`
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * A distinct name *alongside* an existing file (FR-026): `<base>-2.md`,
 * `<base>-3.md`, … Nothing is ever overwritten or moved.
 *
 * `exists` is injected so the caller owns the filesystem question and this
 * stays pure.
 */
export function distinctName(base: string, ext: string, exists: (name: string) => boolean): string {
  const first = `${base}${ext}`
  if (!exists(first)) return first
  let n = 2
  while (exists(`${base}-${n}${ext}`)) n++
  return `${base}-${n}${ext}`
}
