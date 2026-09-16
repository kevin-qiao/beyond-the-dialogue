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
 * The absolute root a destination resolves against.
 * `wiki` uses the app's configured wiki location; `folder` uses its own
 * declared absolute path.
 */
export function resolveRoot(paths: PathPort, dest: Destination, wikiRoot: string): string {
  if (dest.store === 'wiki') return paths.normalize(wikiRoot)
  return paths.normalize(dest.rootPath ?? '')
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

export function resolveDestination(paths: PathPort, dest: Destination, wikiRoot: string): ResolvedDestination {
  const root = resolveRoot(paths, dest, wikiRoot)
  const subdir = dest.store === 'wiki' ? (dest.subdir ?? '') : (dest.subdir ?? '')
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
  wikiRoot: string,
  title: string,
  taskId: string
): ArtifactTarget {
  const resolved = resolveDestination(paths, dest, wikiRoot)
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
  wikiRoot: string,
  override: string
): { rootRel: string } | null {
  const resolved = resolveDestination(paths, dest, wikiRoot)
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
  if (dest.store === 'folder') {
    if (!isAbsolutePath(paths, dest.rootPath)) {
      errors.push({ key: 'destination.folderNeedsAbsoluteRoot' })
    }
  } else if (dest.rootPath !== null && dest.rootPath !== undefined) {
    errors.push({ key: 'destination.wikiTakesNoRoot' })
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
export function describeDestination(dest: Destination | undefined | null, wikiRoot?: string): string {
  if (!dest) return '(none)'
  if (dest.store === 'wiki') return `the wiki${dest.subdir ? ` (${dest.subdir}/)` : ''}`
  const base = dest.rootPath ?? '(unset)'
  return dest.subdir ? `${base}/${dest.subdir}` : base
}

export { slugify }
