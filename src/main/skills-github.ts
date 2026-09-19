import * as fs from 'node:fs'
import * as path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { isLocalizedError, LocalizedError } from '../core/i18n/issues'
import { importSkillFolder } from './skills'
import { userDataDir } from './paths'
import type { SkillEntry } from '../shared/types'

// Skill import from GitHub (Settings → Skills): a second source for the SAME
// managed entry. The folder-import contract is not reimplemented here — once
// the archive is on disk and the SKILL.md located, `importSkillFolder` does
// the validation, copying and naming, so the two paths cannot drift.
//
// Deliberately no `git` binary and no new dependency: the GitHub API serves a
// tarball over plain HTTPS (global `fetch`, stable on this Electron's Node),
// `node:zlib` inflates it, and the ustar reader below is ~60 lines because the
// archive shape it accepts is narrow and fully under our caps.
//
// The archive is UNTRUSTED input. Every entry path is normalized and refused
// (`skill.github.badArchive`) if it is absolute or climbs with `..`, the
// extracted result is confined under its temp dir, and both the download and
// the extraction have size caps. Nothing here touches the agent path; imported
// skills remain inert until a type grants them (see src/main/plugins.ts).

export interface GitHubSkillSource {
  owner: string
  repo: string
  /** Branch/tag/commit as named in a `/tree/<ref>` segment; null = default branch. */
  ref: string | null
  /** Repository-relative folder that should contain the SKILL.md; '' = repo root. */
  subdir: string
}

const SEGMENT = /^[A-Za-z0-9._-]+$/
const MAX_TARBALL_BYTES = 64 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 20_000
const TARBALL_LIMIT_LABEL = '64 MB'
const EXTRACTED_LIMIT_LABEL = '256 MB'

function refuse(key: 'skill.github.badArchive' | 'skill.github.tooLarge', params?: Record<string, string>): never {
  throw new LocalizedError([{ key, params }])
}

// ---- URL parsing (pure — unit-tested without any network) ----

/**
 * Recognises `https://github.com/<owner>/<repo>`, the same without a scheme,
 * the `owner/repo` shorthand, and an optional `/tree/<ref>[/<subdir>…]`.
 *
 * The rule after `/tree/` is deterministic: the FIRST segment is the ref, the
 * rest is the subdirectory. A branch whose name contains slashes cannot be
 * expressed this way — that is the documented limitation, and the refusal
 * points the user at the folder import instead of guessing where the ref ends.
 */
export function parseGitHubSkillUrl(raw: string): GitHubSkillSource | null {
  let input = raw.trim()
  if (!input) return null
  // Query/fragment are noise for every accepted shape.
  input = input.split('#')[0]!.split('?')[0]!.trim()
  if (!input) return null

  let rest = input
  const scheme = /^https?:\/\//i.exec(rest)
  if (scheme) {
    rest = rest.slice(scheme[0]!.length)
    const slash = rest.indexOf('/')
    if (slash === -1) return null
    const host = rest.slice(0, slash).toLowerCase()
    if (host !== 'github.com' && host !== 'www.github.com') return null
    rest = rest.slice(slash + 1)
  } else {
    // Host without a scheme, or the bare `owner/repo` shorthand.
    rest = rest.replace(/^(www\.)?github\.com\//i, '')
  }

  let segments: string[]
  try {
    segments = rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
  } catch {
    return null // a malformed percent-escape is not a URL we recognise
  }
  if (segments.length < 2) return null

  const owner = segments[0]!
  const repo = segments[1]!.replace(/\.git$/i, '')
  if (!isSafeName(owner) || !isSafeName(repo)) return null

  const tail = segments.slice(2)
  if (tail.length === 0) return { owner, repo, ref: null, subdir: '' }
  if (tail.length >= 2 && tail[0] === 'tree') {
    const ref = tail[1]!
    const subdir = tail.slice(2)
    if (!ref || ref.includes('..') || !subdir.every(isSafeName)) return null
    return { owner, repo, ref, subdir: subdir.join('/') }
  }
  // Anything else (`/blob/…`, `/issues`, a bare `/tree`) is a link to something
  // that is not a skill source; refuse rather than reinterpret it.
  return null
}

function isSafeName(segment: string): boolean {
  return SEGMENT.test(segment) && segment !== '.' && segment !== '..'
}

// ---- download (the seam tests replace) ----

export interface GitHubFetchResult {
  status: number
  bytes: Uint8Array
}
export type GitHubFetcher = (url: string) => Promise<GitHubFetchResult>

let fetcherOverride: GitHubFetcher | null = null

/** Test seam: replaces the HTTPS download entirely, mirroring `setSessionFactory`. */
export function setGitHubFetcher(fn: GitHubFetcher | null): void {
  fetcherOverride = fn
}

const defaultFetcher: GitHubFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { 'user-agent': 'work-board-skill-import', accept: 'application/vnd.github+json' },
    redirect: 'follow'
  })
  // An early content-length check avoids buffering an oversized body at all.
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_TARBALL_BYTES) refuse('skill.github.tooLarge', { limit: TARBALL_LIMIT_LABEL })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, bytes }
}

export function tarballUrl(source: GitHubSkillSource): string {
  const ref = source.ref ? `/${encodeURIComponent(source.ref)}` : ''
  // The API resolves the default branch when no ref is given and redirects to
  // codeload, which `fetch` follows.
  return `https://api.github.com/repos/${source.owner}/${source.repo}/tarball${ref}`
}

export async function downloadRepoTarball(source: GitHubSkillSource): Promise<Uint8Array> {
  const repo = `${source.owner}/${source.repo}`
  const fetcher = fetcherOverride ?? defaultFetcher
  let res: GitHubFetchResult
  try {
    res = await fetcher(tarballUrl(source))
  } catch (e: any) {
    // A refusal the download already phrased keeps its codes (identity pass,
    // the same rule `localizeThrown` follows); anything else is a fetch failure.
    if (isLocalizedError(e)) throw e
    throw new LocalizedError([
      { key: 'skill.github.fetchFailed', params: { repo, error: String(e?.message ?? e) } }
    ])
  }
  if (res.status === 404) {
    throw new LocalizedError([{ key: 'skill.github.notFound', params: { repo } }])
  }
  if (res.status < 200 || res.status >= 300) {
    throw new LocalizedError([{ key: 'skill.github.fetchFailed', params: { repo, error: `HTTP ${res.status}` } }])
  }
  if (res.bytes.byteLength > MAX_TARBALL_BYTES) {
    refuse('skill.github.tooLarge', { limit: TARBALL_LIMIT_LABEL })
  }
  return res.bytes
}

// ---- the ustar reader ----

interface TarEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  dataOffset: number
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length)
  let end = 0
  while (end < slice.length && slice[end] !== 0) end++
  return Buffer.from(slice.subarray(0, end)).toString('utf-8')
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim()
  if (!text) return 0
  const n = Number.parseInt(text, 8)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function isZeroBlock(block: Uint8Array): boolean {
  return block.every((b) => b === 0)
}

/** Entry names, normalized to '/' form — or a refusal when one is unsafe. */
function normalizeEntryPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) refuse('skill.github.badArchive')
  const rel = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/')
  if (rel.split('/').includes('..')) refuse('skill.github.badArchive')
  return rel
}

function readTarEntries(tar: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    // An all-zero block is the end-of-archive marker.
    if (isZeroBlock(header)) break
    const name = readString(header, 0, 100)
    const magic = readString(header, 257, 6)
    const prefix = magic.startsWith('ustar') ? readString(header, 345, 155) : ''
    const size = readOctal(header, 124, 12)
    if (size > MAX_EXTRACTED_BYTES) refuse('skill.github.tooLarge', { limit: EXTRACTED_LIMIT_LABEL })
    const typeflag = header[156] === 0 ? '\0' : String.fromCharCode(header[156]!)
    if (name) {
      const full = normalizeEntryPath(prefix ? `${prefix}/${name}` : name)
      // Regular files and directories only; symlinks, devices and friends are
      // skipped — an imported skill is markdown plus data, never a link farm.
      const type = typeflag === '5' ? 'dir' : typeflag === '0' || typeflag === '\0' ? 'file' : null
      if (full && type) {
        entries.push({ name: full, type, size: type === 'file' ? size : 0, dataOffset: offset + 512 })
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

/**
 * GitHub's tarballs wrap everything in a single `<owner>-<repo>-<sha>/`
 * directory; stripping it makes the extraction root the repository root. The
 * strip only happens when EVERY entry shares that top segment and at least one
 * entry lives below it, so a flat archive is extracted as-is.
 */
function commonTopSegment(names: string[]): string | null {
  if (names.length === 0) return null
  const first = names[0]!.split('/')[0]!
  if (!names.every((n) => n.split('/')[0] === first)) return null
  return names.some((n) => n.includes('/')) ? first : null
}

/**
 * Inflate and extract a `.tar.gz` into `destDir`. Refuses (writes nothing
 * further) on a malformed archive, an unsafe entry path, or a cap breach.
 */
export function extractTarGz(bytes: Uint8Array, destDir: string): void {
  let tar: Uint8Array
  try {
    tar = new Uint8Array(gunzipSync(bytes))
  } catch {
    refuse('skill.github.badArchive')
  }
  const entries = readTarEntries(tar)
  const strip = commonTopSegment(entries.map((e) => e.name))
  let totalBytes = 0
  let count = 0
  for (const entry of entries) {
    const rel = strip && entry.name.startsWith(`${strip}/`) ? entry.name.slice(strip.length + 1) : entry.name
    // The top directory itself (and anything that strips to nothing) is noise.
    if (!rel || rel === strip) continue
    if (++count > MAX_ENTRIES) refuse('skill.github.tooLarge', { limit: `${MAX_ENTRIES} entries` })
    const target = path.join(destDir, ...rel.split('/'))
    // Confinement, the same relative()/.. test the artifact destination uses:
    // the normalized name already refused a climb, and this is the belt.
    const relCheck = path.relative(destDir, target)
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) refuse('skill.github.badArchive')
    if (entry.type === 'dir') {
      fs.mkdirSync(target, { recursive: true })
      continue
    }
    totalBytes += entry.size
    if (totalBytes > MAX_EXTRACTED_BYTES) refuse('skill.github.tooLarge', { limit: EXTRACTED_LIMIT_LABEL })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, tar.subarray(entry.dataOffset, entry.dataOffset + entry.size))
  }
}

// ---- orchestration ----

/**
 * Import a skill straight from a GitHub URL. The downloaded archive lands in a
 * temp dir under userData (never a hardcoded path), the SKILL.md is located at
 * the URL's subdir (or the repo root), and the folder is imported through the
 * one implementation that already exists. The temp dir is removed either way.
 */
export async function importSkillFromGitHub(url: string): Promise<SkillEntry> {
  const source = parseGitHubSkillUrl(url)
  if (!source) {
    throw new LocalizedError([{ key: 'skill.github.urlInvalid', params: { url: url.trim() || '(empty)' } }])
  }
  const tmpRoot = path.join(userDataDir(), 'tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const work = fs.mkdtempSync(path.join(tmpRoot, 'gh-skill-'))
  try {
    const bytes = await downloadRepoTarball(source)
    const extracted = path.join(work, 'src')
    fs.mkdirSync(extracted, { recursive: true })
    extractTarGz(bytes, extracted)

    const skillDir = source.subdir ? path.join(extracted, ...source.subdir.split('/')) : extracted
    const inside = path.relative(extracted, skillDir)
    if (inside.startsWith('..') || path.isAbsolute(inside)) refuse('skill.github.badArchive')
    const skillMd = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) {
      throw new LocalizedError([
        { key: 'skill.github.noSkillMd', params: { where: source.subdir ? `/${source.subdir}` : '/' } }
      ])
    }
    return importSkillFolder(skillDir)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
