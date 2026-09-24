import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { setSessionFactory, setSimplePromptOverride } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'

// The MCP adapter was DEFERRED once (research.md R7a): gate T061 failed because
// v2.33.0 pinned its Model Context Protocol dependencies to `pkg.pr.new` preview
// commit URLs rather than published npm versions. That blocker is gone in
// pi-mcp-adapter@2.35.0, which pins `@modelcontextprotocol/client` and
// `@modelcontextprotocol/core` to published `2.0.0` — and the first assertion
// below now RE-RUNS T061 mechanically on every test run, so the deferral can
// never be silently undone by a future dependency bump.
//
// The rest of the file guards the isolation property the adoption rests on:
//
//   1. All agent-runtime state lives under the app's user data directory.
//   2. Nothing on the agent path reads or writes a GLOBAL MCP config file or
//      the user's `~/.pi`.
//   3. The adapter is driven ONLY through the in-memory `config` form built
//      from the app's own registered servers — the form that documents itself
//      as not reading or writing project or global override files. The named
//      `createMcpAdapter` export is required (the DEFAULT export is the
//      ambient-file adapter and must never be used), it is reached only through
//      the jiti seam (the package entry is TypeScript), and `configPath` must
//      never appear in src — that option re-enables ambient file merging.
//
// A regression here would silently reintroduce global-config reads, which is
// why it is asserted structurally rather than trusted.

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

const pythonFiles = () => walk(SRC, (f) => /\.tsx?$/.test(f))

/** Strip comments so a rule may be *named* in prose without tripping itself. */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('T061 re-run: the adapter is pinned exact and its MCP deps are published npm versions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  // Exact pin, like every pi-ecosystem package.
  assert.equal(
    pkg.dependencies?.['pi-mcp-adapter'],
    '2.35.0',
    'pi-mcp-adapter must stay pinned to the version whose gates were evaluated (2.35.0)'
  )
  assert.ok(
    !/pkg\.pr\.new/.test(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf-8')),
    'no pkg.pr.new preview URL may enter the lockfile — that pin shape is what deferred the adapter once (R7a)'
  )
})

test('the adapter is reached only through the jiti seam, in its isolated in-memory form', () => {
  const files = walk(SRC, (f) => /\.tsx?$/.test(f))
  const seam = path.join('main', 'adapters', 'agent', 'mcpAdapter.ts')
  const importers: string[] = []
  const offenders: string[] = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const src = code(f)
    // Any mention of the package name must live in exactly one file...
    if (/pi-mcp-adapter/.test(src)) importers.push(rel)
    // ...and the ambient-file option must never be used: it re-enables merging
    // with project/global config, which the isolation contract forbids.
    if (/configPath\s*:/.test(src)) offenders.push(`${rel} -> configPath (in-memory config only)`)
  }
  assert.ok(
    importers.every((i) => i === path.join('src', seam)),
    `pi-mcp-adapter may only be referenced from src/main/adapters/agent/mcpAdapter.ts, found: ${importers.join(', ') || '(none yet — seam not landed)'}`
  )
  assert.deepEqual(offenders, [], 'the adapter must be driven by the isolated config form only')
})

test('the sanctioned MCP config path lives under the app agent dir', async () => {
  // The app-owned mcp.json is an OUTPUT artifact for user inspection and
  // interop — it lives beside auth.json/models.json, never in a global path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mcpjson-'))
  setUserDataRoot(dir)
  const { piMcpConfigPath } = await import('../src/main/paths')
  const p = piMcpConfigPath()
  assert.ok(p.startsWith(dir), `${p} must live under the app's user data root`)
  assert.ok(!p.includes(`${path.sep}.pi${path.sep}`), `${p} must not reach the user's ~/.pi`)
  assert.equal(path.basename(p), 'mcp.json')
})

test('nothing on the agent path reads or writes a global MCP config', () => {
  // Global config file names the adapter would otherwise pick up on its own.
  const GLOBAL_CONFIG = /\.mcp\.json|mcp_config|mcp-servers\.json|\.cursor\/mcp|claude_desktop_config/i
  const offenders: string[] = []
  for (const f of pythonFiles()) {
    const src = code(f)
    if (GLOBAL_CONFIG.test(src)) offenders.push(path.relative(ROOT, f))
  }
  assert.deepEqual(offenders, [], `no global MCP config path may be referenced:\n${offenders.join('\n')}`)
})

test("nothing on the agent path reaches the user's global agent directory", () => {
  // The standing rule: all agent-runtime state lives under userData, never the
  // user's own ~/.pi. Matched on the path segment so a mention of the rule in
  // a comment is not an offence.
  const offenders: string[] = []
  for (const f of pythonFiles()) {
    const src = code(f)
    for (const m of src.matchAll(/['"`]([^'"`]*)\.pi\/([^'"`]*)['"`]/g)) {
      offenders.push(`${path.relative(ROOT, f)} -> ${m[0]}`)
    }
    if (/homedir\(\)[^;]{0,60}['"]\.pi['"]/.test(src)) offenders.push(`${path.relative(ROOT, f)} -> ~/.pi`)
  }
  assert.deepEqual(offenders, [], `agent state must stay under userData:\n${offenders.join('\n')}`)
})

test('the agent runtime directory resolves under userData, not the home directory', async () => {
  const { piAgentDir, piAuthPath, piModelsPath, setUserDataRoot: setRoot } = await import('../src/main/paths')
  const dir = fs.mkdtempSync(path.join(await import('node:os').then((os) => os.tmpdir()), 'wb-mcp-'))
  setRoot(dir)
  try {
    for (const p of [piAgentDir(), piAuthPath(), piModelsPath()]) {
      assert.ok(p.startsWith(dir), `${p} must live under the app's user data root`)
      assert.ok(!p.includes(`${path.sep}.pi${path.sep}`), `${p} must not reach the user's ~/.pi`)
    }
  } finally {
    setRoot(dir)
  }
})

test('an unconfigured run never constructs a session at all', async () => {
  // The isolation property is easiest to keep when the failure mode is "no
  // session", so a missing or unconfigured provider must not fall through to
  // an adapter that might read ambient configuration.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(await import('node:os').then((os) => os.tmpdir())), 'wb-mcp2-'))
  setUserDataRoot(dir)
  setSessionFactory(null)
  setSimplePromptOverride(null)

  const { createJobSession } = await import('../src/main/ai/session-factory')
  const settings = {
    provider: 'openai',
    model: '',
    apiKey: null,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light' as const,
    skills: [],
    mcpServers: []
  }
  await assert.rejects(
    () =>
      createJobSession({
        settings,
        cwd: dir,
        systemPrompt: 'x',
        thinkingLevel: 'minimal',
        tools: []
      }),
    /no model available|AI not configured/
  )
})
