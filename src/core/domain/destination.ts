import type { Destination, ResolvedDestination } from '../../shared/types'
import type { PathPort } from '../ports/paths'
import { slugify } from './slug'
import { DESTINATION_STORES, isDestinationStore } from './categories'
import type { IssueList } from '../i18n/issues'

// Output destinations: where a type's finished artifacts are written
// (contracts/destination.md).
//
// A destination is declared as structured data and resolved at *write* time,
// so confinement is checked by construction rather than by inspection. The
// containment test below is the app's proven control — it is the same
// `relative` + not-`..` + not-absolute check the wiki ingest path has always
// used. There is deliberately ONE implementation: two implementations of a
// security check drift, and the drift is invisible.

export interface ArtifactTarget extends ResolvedDestination {
  /** Absolute path of the artifact file. */
  abs: string
  /** Path of the artifact relative to `absRoot`, '/'-separated. */
  rel: string
  /** Path of the artifact relative to `root` (subdir included), '/'-separated. */
  rootRel: string
  /** Whether `abs` genuinely lies inside `absRoot`. */
  inside: boolean
}

/**
 * The absolute root a destination resolves against. Both stores declare their
 * own location: `store` says what happens when an artifact is written (the
 * wiki scaffolds itself and gets curated; a folder is left alone), not where
 * the path comes from. There is no global wiki location and no default — a
 * blank root is refused by the caller that has to write, never resolved
 * against the working directory or some built-in path.
 */
export function resolveRoot(paths: PathPort, dest: Destination): string {
  return paths.normalize((dest.rootPath ?? '').trim())
}

/**
 * The confinement test. Lifted verbatim from the wiki's learning-note
 * resolution: compute the relative path and reject anything that is absolute
 * or climbs out with `..`.
 */
export function isInsideRoot(paths: PathPort, root: string, abs: string): boolean {
  const rel = paths.relative(root, abs)
  return !!rel && !rel.startsWith('..') && !paths.isAbsolute(rel)
}

export function resolveDestination(paths: PathPort, dest: Destination): ResolvedDestination {
  const root = resolveRoot(paths, dest)
  const subdir = dest.subdir ?? ''
  const absRoot = subdir ? paths.normalize(paths.join(root, subdir)) : root
  return { store: dest.store, root, subdir, absRoot }
}

/**
 * Resolve the concrete artifact path for a task. The filename is derived from
 * the title (never stored), which is what makes a destination movable without
 * rewriting anything.
 */
export function resolveArtifact(
  paths: PathPort,
  dest: Destination,
  title: string,
  taskId: string
): ArtifactTarget {
  const resolved = resolveDestination(paths, dest)
  const abs = paths.normalize(paths.join(resolved.absRoot, `${slugify(title, taskId)}.md`))
  const inside = isInsideRoot(paths, resolved.absRoot, abs)
  const rawRel = inside ? paths.relative(resolved.absRoot, abs) : ''
  const rel = rawRel.split(paths.sep).join('/')
  const subdir = resolved.subdir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return {
    ...resolved,
    abs,
    rel,
    rootRel: rel && subdir ? `${subdir}/${rel}` : rel || subdir,
    inside
  }
}

/**
 * A destination must be absolute, so a relative or empty `rootPath` can never
 * silently resolve against the process working directory.
 */
export function isAbsolutePath(paths: PathPort, p: unknown): boolean {
  return typeof p === 'string' && p.trim().length > 0 && paths.isAbsolute(p.trim())
}

/**
 * Confine a user-supplied artifact path against a destination. The override may
 * be relative to the destination root or absolute; either way it must land
 * inside the root.
 *
 * Returns null when it escapes, and callers MUST refuse rather than fall back
 * to a default. A silent fallback is the failure mode this guards: a stored
 * path that no longer resolves (the wiki moved) would quietly be replaced by
 * the default, and the user's note would be filed somewhere they did not
 * choose — which is exactly the "mis-save" the original learning-note check
 * existed to prevent.
 */
export function confineOverride(
  paths: PathPort,
  dest: Destination,
  override: string
): { rootRel: string } | null {
  const resolved = resolveDestination(paths, dest)
  const trimmed = override.trim()
  if (!trimmed) return null
  const abs = paths.isAbsolute(trimmed) ? paths.normalize(trimmed) : paths.normalize(paths.join(resolved.root, trimmed))
  if (!isInsideRoot(paths, resolved.root, abs)) return null
  // `isInsideRoot` guarantees a non-empty relative path, so this is never ''.
  return { rootRel: paths.relative(resolved.root, abs).split(paths.sep).join('/') }
}

/**
 * Configuration-time validation (contracts/destination.md §5, first four
 * rows). Returns codes for the caller to phrase; an empty array means valid.
 *
 * The last two rows of that table — the path resolves inside the root, and
 * the root is writable — are runtime conditions checked when a finish runs,
 * because a folder can disappear after the type was saved.
 */
export function validateDestination(paths: PathPort, dest: Destination | undefined | null): IssueList {
  if (!dest) return []
  const errors: IssueList = []
  if (!isDestinationStore(dest.store)) {
    errors.push({ key: 'destination.storeUnknown', params: { stores: DESTINATION_STORES.join(', ') } })
    return errors
  }
  // Both stores declare their own location — there is no global wiki path to
  // inherit and no built-in default. The stores differ in WHEN the absence of
  // a root is wrong: a folder destination means nothing without one, so it is
  // a save-time error; a wiki destination may legitimately be saved before it
  // has been pointed (the seeded Learning type starts that way), so a blank
  // root is an INCOMPLETE config refused at Finish, while a named-but-relative
  // root is the save-time error.
  if (dest.store === 'wiki') {
    const root = (dest.rootPath ?? '').trim()
    if (root && !isAbsolutePath(paths, root)) {
      errors.push({ key: 'destination.wikiNeedsRoot' })
    }
  } else if (!isAbsolutePath(paths, dest.rootPath)) {
    errors.push({ key: 'destination.folderNeedsAbsoluteRoot' })
  }
  const subdir = dest.subdir ?? ''
  if (typeof subdir !== 'string') {
    errors.push({ key: 'destination.subdirNotString' })
  } else if (paths.isAbsolute(subdir)) {
    errors.push({ key: 'destination.subdirAbsolute' })
  } else if (subdir.split(/[\\/]/).some((seg) => seg === '..')) {
    errors.push({ key: 'destination.subdirTraversal' })
  }
  return errors
}

/**
 * A short human description of a destination, for toasts and error messages.
 * Storage locations are shown as a path the user can recognise.
 */
export function describeDestination(dest: Destination | undefined | null): string {
  if (!dest) return '(none)'
  const base = dest.rootPath ?? '(unset)'
  if (dest.store === 'wiki') {
    return `the wiki at ${base}${dest.subdir ? ` (${dest.subdir}/)` : ''}`
  }
  return dest.subdir ? `${base}/${dest.subdir}` : base
}

export { slugify }
