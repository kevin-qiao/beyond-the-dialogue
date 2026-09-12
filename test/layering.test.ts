import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Layering guard (contracts/app-client.md §2, constitution Principle III).
//
// src/core is bundled into BOTH the main target and the renderer target, so
// an `electron`, `node:*` or DOM reference there breaks one of them at build
// time — but only for whichever host happens to build first. These assertions
// make the boundary a property of the test suite instead of a build accident.
//
// Mechanical by design: no allowlist, no exceptions. If a core module needs
// I/O, it takes a port (src/core/ports) and the adapter lives in src/main.

const ROOT = path.resolve(import.meta.dirname, '..')
const CORE = path.join(ROOT, 'src', 'core')
const RENDERER = path.join(ROOT, 'src', 'renderer')

function walk(dir: string, filter: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

// Comments are stripped before matching so a rule may be *named* in prose
// (e.g. "MUST NOT import node:fs") without tripping itself.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const coreFiles = () => walk(CORE, (f) => f.endsWith('.ts'))

test('core layer contains no platform imports: electron', () => {
  const offenders: string[] = []
  for (const f of coreFiles()) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    if (/from\s+['"]electron['"]/.test(code) || /require\(\s*['"]electron['"]\s*\)/.test(code)) {
      offenders.push(path.relative(ROOT, f))
    }
  }
  assert.deepEqual(offenders, [], `src/core must not import electron:\n${offenders.join('\n')}`)
})

test('core layer contains no platform imports: node:*', () => {
  const offenders: string[] = []
  for (const f of coreFiles()) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    if (/from\s+['"]node:/.test(code) || /require\(\s*['"]node:/.test(code)) {
      offenders.push(path.relative(ROOT, f))
    }
  }
  assert.deepEqual(offenders, [], `src/core must not import node:* builtins:\n${offenders.join('\n')}`)
})

test('core layer contains no bare node builtin imports', () => {
  // `import * as fs from 'fs'` (no node: prefix) is equally fatal in a
  // renderer bundle and just as easy to type by accident.
  const BARE = ['fs', 'path', 'os', 'crypto', 'child_process', 'events', 'url', 'util', 'sqlite']
  const offenders: string[] = []
  for (const f of coreFiles()) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    for (const mod of BARE) {
      const re = new RegExp(`from\\s+['"]${mod}['"]`)
      if (re.test(code)) offenders.push(`${path.relative(ROOT, f)} -> ${mod}`)
    }
  }
  assert.deepEqual(offenders, [], `src/core must not import node builtins:\n${offenders.join('\n')}`)
})

test('core layer contains no DOM globals', () => {
  // The mirror image of the previous rule: core is also compiled into the
  // main target, which has no DOM.
  const DOM = /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|HTMLElement|XMLHttpRequest)\s*[.([]/
  const offenders: string[] = []
  for (const f of coreFiles()) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    if (DOM.test(code)) offenders.push(path.relative(ROOT, f))
  }
  assert.deepEqual(offenders, [], `src/core must not touch DOM globals:\n${offenders.join('\n')}`)
})

test('renderer imports nothing from src/main', () => {
  // The UI must not depend on a host (contracts/app-client.md §4). This is
  // already true; the assertion is here so it stays true.
  //
  // The `main` segment is matched with a leading boundary: a bare `main\/`
  // also matches `domain/`, which would flag every `src/core/domain/...`
  // import — a guard that cries wolf gets weakened, and a weakened guard is
  // worse than none.
  const MAIN_SEGMENT = /(^|\/)main\//
  const offenders: string[] = []
  for (const f of walk(RENDERER, (f) => /\.tsx?$/.test(f))) {
    const code = stripComments(fs.readFileSync(f, 'utf-8'))
    for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      // Only relative specifiers can reach src/main from the renderer.
      const spec = m[1]!
      if (!spec.startsWith('.')) continue
      const resolved = path.resolve(path.dirname(f), spec)
      if (MAIN_SEGMENT.test(resolved)) offenders.push(`${path.relative(ROOT, f)} -> ${spec}`)
    }
  }
  assert.deepEqual(offenders, [], `src/renderer must not import src/main:\n${offenders.join('\n')}`)
})

test('the core layer exists and is non-empty', () => {
  // Guards against the guard silently passing because src/core was renamed
  // away or emptied — a suite that reports green on a missing layer is worse
  // than one that reports nothing.
  const files = coreFiles()
  assert.ok(files.length >= 4, `expected src/core to hold real modules, found ${files.length} file(s)`)
})
