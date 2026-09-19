import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { gzipSync } from 'node:zlib'
import { issueKeysOf } from './helpers/issues'
import {
  parseGitHubSkillUrl,
  extractTarGz,
  importSkillFromGitHub,
  setGitHubFetcher,
  tarballUrl
} from '../src/main/skills-github'
import { setUserDataRoot, skillsDir } from '../src/main/paths'

// The GitHub skill import: URL parsing, the ustar reader's safety refusals,
// and the end-to-end import through the scripted fetcher seam. No test here
// touches the network — the seam replaces the download entirely, the same
// contract setSessionFactory has for the agent runtime.

// ---- a minimal tar writer, because the reader needs real archives ----

function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, Math.min(name.length, 100), 'utf-8')
  header.write('0000644\0', 100, 8, 'utf-8')
  header.write('0000000\0', 108, 8, 'utf-8')
  header.write('0000000\0', 116, 8, 'utf-8')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8')
  header.write('00000000000\0', 136, 12, 'utf-8')
  header.write('        ', 148, 8, 'utf-8') // checksum placeholder: spaces
  header.write(typeflag, 156, 1, 'utf-8')
  header.write('ustar\0', 257, 6, 'utf-8')
  header.write('00', 263, 2, 'utf-8')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8')
  return header
}

interface FixtureEntry {
  name: string
  content?: string
  dir?: boolean
}

function makeTarGz(entries: FixtureEntry[]): Uint8Array {
  const chunks: Buffer[] = []
  for (const e of entries) {
    if (e.dir) {
      chunks.push(tarHeader(e.name.endsWith('/') ? e.name : `${e.name}/`, 0, '5'))
      continue
    }
    const body = Buffer.from(e.content ?? '', 'utf-8')
    chunks.push(tarHeader(e.name, body.length, '0'))
    chunks.push(body)
    const pad = (512 - (body.length % 512)) % 512
    if (pad > 0) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024)) // end-of-archive marker
  return new Uint8Array(gzipSync(Buffer.concat(chunks)))
}

const SKILL_MD = `---
name: pdf-tools
description: Tools for working with PDF files
---

# PDF tools

Do PDF things.
`

afterEach(() => setGitHubFetcher(null))

// ---- URL parsing (pure) ----

test('parseGitHubSkillUrl accepts the documented shapes', () => {
  const base = { owner: 'anthropics', repo: 'skills', ref: null, subdir: '' }
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills'), base)
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills.git'), base, '.git suffix is stripped')
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills/'), base, 'trailing slash')
  assert.deepEqual(parseGitHubSkillUrl('github.com/anthropics/skills'), base, 'schemeless host')
  assert.deepEqual(parseGitHubSkillUrl('https://www.github.com/anthropics/skills'), base, 'www host')
  assert.deepEqual(parseGitHubSkillUrl('anthropics/skills'), base, 'owner/repo shorthand')
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills?tab=readme-ov-file'), base, 'query stripped')
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills/tree/main#files'), {
    ...base,
    ref: 'main'
  }, 'ref with fragment stripped')
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/anthropics/skills/tree/v1.2/document-skills/pdf'), {
    ...base,
    ref: 'v1.2',
    subdir: 'document-skills/pdf'
  }, 'first segment after /tree/ is the ref, the rest is the subdir')
})

test('parseGitHubSkillUrl refuses anything it cannot interpret', () => {
  for (const bad of [
    '',
    '   ',
    'not a url at all',
    'https://gitlab.com/o/r',
    'https://example.com/github.com/o/r',
    'https://github.com/o',
    'https://github.com/o/r/blob/main/README.md',
    'https://github.com/o/r/tree',
    'https://github.com/o/r/releases',
    'https://github.com/../etc/passwd',
    'https://github.com/o%2Fr/r',
    '/absolute/o/r'
  ]) {
    assert.equal(parseGitHubSkillUrl(bad), null, `expected refusal: ${JSON.stringify(bad)}`)
  }
})

test('tarballUrl points at the API endpoint that resolves the default branch', () => {
  assert.equal(
    tarballUrl({ owner: 'o', repo: 'r', ref: null, subdir: '' }),
    'https://api.github.com/repos/o/r/tarball'
  )
  assert.equal(
    tarballUrl({ owner: 'o', repo: 'r', ref: 'v1.2', subdir: 'x' }),
    'https://api.github.com/repos/o/r/tarball/v1.2'
  )
})

// ---- the ustar reader ----

test('extractTarGz strips the single top-level directory GitHub wraps everything in', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tar-'))
  const bytes = makeTarGz([
    { name: 'o-r-sha1', dir: true },
    { name: 'o-r-sha1/SKILL.md', content: SKILL_MD },
    { name: 'o-r-sha1/assets', dir: true },
    { name: 'o-r-sha1/assets/ref.md', content: 'reference' }
  ])
  extractTarGz(bytes, dest)
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf-8'), SKILL_MD)
  assert.equal(fs.readFileSync(path.join(dest, 'assets', 'ref.md'), 'utf-8'), 'reference')
  assert.equal(fs.existsSync(path.join(dest, 'o-r-sha1')), false, 'the wrapper directory is gone')
})

test('extractTarGz leaves a flat archive as-is', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tar-'))
  extractTarGz(makeTarGz([{ name: 'SKILL.md', content: SKILL_MD }]), dest)
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')))
})

test('extractTarGz refuses an entry that climbs out, and writes nothing from it', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tar-'))
  const bytes = makeTarGz([
    { name: 'top', dir: true },
    { name: 'top/ok.md', content: 'fine' },
    { name: 'top/../../evil.md', content: 'escaped' }
  ])
  assert.throws(
    () => extractTarGz(bytes, dest),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.badArchive'])
      return true
    }
  )
  assert.equal(fs.existsSync(path.join(dest, '..', 'evil.md')), false)
  assert.equal(fs.existsSync('/evil.md'), false)
})

test('extractTarGz refuses an absolute entry path and a malformed archive', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tar-'))
  assert.throws(
    () => extractTarGz(makeTarGz([{ name: '/etc/passwd', content: 'x' }]), dest),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.badArchive'])
      return true
    }
  )
  assert.throws(
    () => extractTarGz(new Uint8Array([1, 2, 3, 4, 5]), dest),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.badArchive'])
      return true
    },
    'not gzip at all'
  )
})

// ---- the import, end to end through the seam ----

function freshRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-skill-gh-'))
  setUserDataRoot(dir)
  return dir
}

const repoTarball = makeTarGz([
  { name: 'o-r-sha1', dir: true },
  { name: 'o-r-sha1/SKILL.md', content: SKILL_MD },
  { name: 'o-r-sha1/scripts/extract.py', content: 'print("hi")' }
])

test('importSkillFromGitHub lands the skill in the managed dir and cleans up', async () => {
  const dir = freshRoot()
  const seen: string[] = []
  setGitHubFetcher(async (url) => {
    seen.push(url)
    return { status: 200, bytes: repoTarball }
  })

  const entry = await importSkillFromGitHub('https://github.com/o/r')

  assert.deepEqual(seen, ['https://api.github.com/repos/o/r/tarball'])
  assert.equal(entry.name, 'pdf-tools', 'the frontmatter name wins, same as the folder import')
  assert.equal(entry.description, 'Tools for working with PDF files')
  assert.equal(entry.path, path.join(skillsDir(), 'pdf-tools'))
  assert.equal(fs.readFileSync(path.join(entry.path, 'SKILL.md'), 'utf-8'), SKILL_MD)
  assert.ok(fs.existsSync(path.join(entry.path, 'scripts', 'extract.py')), 'supporting files came along')
  // The temp workspace is gone; nothing litters userData.
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), [])
})

test('importSkillFromGitHub honours /tree/<ref>/<subdir>', async () => {
  freshRoot()
  const nested = makeTarGz([
    { name: 'top', dir: true },
    { name: 'top/SKILL.md', content: '---\nname: wrong-one\n---\n' },
    { name: 'top/pack', dir: true },
    { name: 'top/pack/SKILL.md', content: SKILL_MD }
  ])
  const seen: string[] = []
  setGitHubFetcher(async (url) => {
    seen.push(url)
    return { status: 200, bytes: nested }
  })

  const entry = await importSkillFromGitHub('https://github.com/o/r/tree/main/pack')
  assert.deepEqual(seen, ['https://api.github.com/repos/o/r/tarball/main'])
  assert.equal(entry.name, 'pdf-tools', 'the SUBDIR skill was imported, not the repo root one')
})

test('importSkillFromGitHub refuses in codes, never with a guess', async () => {
  freshRoot()

  // A URL that is not a GitHub skill source — refused before any download.
  let fetched = false
  setGitHubFetcher(async () => {
    fetched = true
    return { status: 200, bytes: repoTarball }
  })
  await assert.rejects(
    () => importSkillFromGitHub('https://gitlab.com/o/r'),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.urlInvalid'])
      return true
    }
  )
  assert.equal(fetched, false, 'an invalid URL never reaches the network')

  // The repo does not exist.
  setGitHubFetcher(async () => ({ status: 404, bytes: new Uint8Array() }))
  await assert.rejects(
    () => importSkillFromGitHub('https://github.com/o/gone'),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.notFound'])
      return true
    }
  )

  // A server-side failure keeps its status in the message.
  setGitHubFetcher(async () => ({ status: 503, bytes: new Uint8Array() }))
  await assert.rejects(
    () => importSkillFromGitHub('https://github.com/o/r'),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.fetchFailed'])
      return true
    }
  )

  // The archive has no SKILL.md where the URL said it would be.
  const bare = makeTarGz([{ name: 'top', dir: true }, { name: 'top/README.md', content: 'hello' }])
  setGitHubFetcher(async () => ({ status: 200, bytes: bare }))
  await assert.rejects(
    () => importSkillFromGitHub('https://github.com/o/r/tree/main/skills'),
    (e: unknown) => {
      assert.deepEqual(issueKeysOf(e), ['skill.github.noSkillMd'])
      return true
    }
  )
  assert.equal(fs.existsSync(skillsDir()), false, 'a refused import created no managed skill')
})
