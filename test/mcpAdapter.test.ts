import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setSessionFactory, setSimplePromptOverride } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'

// The MCP adapter was DEFERRED (research.md R7a): gate T061 failed because the
// community package pins its Model Context Protocol dependencies to
// `pkg.pr.new` preview commit URLs rather than published npm versions, and the
// remaining gates could not be completed. No adapter is installed.
//
// This file is therefore not a test of an adapter. It is a guard on the
// isolation property the adoption rested on, so it cannot be lost in the
// meantime or reintroduced carelessly when the transport lands:
//
//   1. All agent-runtime state lives under the app's user data directory.
//   2. Nothing on the agent path reads or writes a GLOBAL MCP config file or
//      the user's `~/.pi`.
//   3. When a config is supplied it is the in-memory form built from the app's
//      own registered servers — the form that documents itself as not touching
//      project or global override files.
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

test('the adapter is not installed, so the tool-server half is not being claimed', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.equal(
    Object.keys(deps).includes('pi-mcp-adapter'),
    false,
    'pi-mcp-adapter must not be a dependency while FR-018 remains amended'
  )
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
    wikiPath: '',
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
