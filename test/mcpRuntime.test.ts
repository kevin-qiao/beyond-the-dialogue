import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildMcpExtension, setMcpAdapterFactory } from '../src/main/adapters/agent/mcpAdapter'
import { resolveGrant } from '../src/core/domain/grant'
import { NO_GRANT } from '../src/shared/types'
import type { McpServerEntry, PluginGrant, TaskTypeDef } from '../src/shared/types'

// The runtime half of add-mcp-support: who is handed an MCP adapter, and with
// what. Everything here runs against a SCRIPTED adapter factory — no pi-mcp-
// adapter, no provider, no server is ever contacted. The confinement decision
// itself is owned by resolveGrant (test/grants.test.ts); these tests pin that
// the seam honours it and filters the snapshot to exactly the granted names.

const entries: McpServerEntry[] = [
  { name: 'a', config: { command: 'x' } },
  { name: 'b', config: { url: 'https://b/mcp' } },
  { name: 'c', config: { command: 'z' } }
]

function grant(toolServers: string[]): PluginGrant {
  return { skills: [], toolServers }
}

test.afterEach(() => setMcpAdapterFactory(null))

test('no tool servers granted → no adapter is constructed, at all', async () => {
  let constructed = 0
  setMcpAdapterFactory(() => {
    constructed++
    return {}
  })
  const r = await buildMcpExtension(entries, grant([]))
  assert.deepEqual(r, { extension: null, toolNames: [], missingGranted: [] })
  assert.equal(constructed, 0)
})

test('the snapshot handed to the adapter is exactly the granted servers, config intact', async () => {
  let snapshot: Record<string, Record<string, unknown>> | null = null
  const sentinel = { __scripted: true }
  setMcpAdapterFactory((s) => {
    snapshot = s
    return sentinel
  })
  const r = await buildMcpExtension(entries, grant(['c', 'a']))
  assert.deepEqual(snapshot, { c: { command: 'z' }, a: { command: 'x' } })
  assert.equal(r.extension, sentinel)
  assert.deepEqual(r.toolNames, ['mcp'])
  assert.deepEqual(r.missingGranted, [])
})

test('a granted name with no registered config is reported, not swallowed (FR-024)', async () => {
  setMcpAdapterFactory(() => ({}))
  const partial = await buildMcpExtension(entries, grant(['a', 'gone']))
  assert.deepEqual(partial.missingGranted, ['gone'])
  assert.ok(partial.extension, 'the valid server is still wired')

  // Nothing valid at all: no adapter with an empty config.
  const none = await buildMcpExtension(entries, grant(['gone']))
  assert.equal(none.extension, null)
  assert.deepEqual(none.missingGranted, ['gone'])
})

test('a confined purpose arrives with NO_GRANT, so the seam constructs nothing — even for a misconfigured type', async () => {
  // resolveGrant is the confinement guarantee; this proves the MCP seam
  // consumes it faithfully: the type below grants a server that IS registered,
  // yet a confined purpose still wires nothing.
  const typeDef = { grants: grant(['a']) } as TaskTypeDef
  const confined = resolveGrant({ purpose: 'confined', typeDef })
  assert.deepEqual(confined, NO_GRANT)
  let constructed = 0
  setMcpAdapterFactory(() => {
    constructed++
    return {}
  })
  const r = await buildMcpExtension(entries, confined)
  assert.equal(r.extension, null)
  assert.equal(constructed, 0)
})

test('the session factory wires the extension as an inline factory and names the mcp tool', () => {
  // Structural: the seam must register through extensionFactories (loaded
  // even under noExtensions) and extend the tools allowlist. Tests override
  // the whole session factory, so the wiring itself can only be pinned here
  // — its behavior is exercised by the dev harness.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/main/ai/session-factory.ts'), 'utf-8')
  assert.ok(/buildMcpExtension\(/.test(src), 'session-factory must build the extension from the resolved grant')
  assert.ok(/extensionFactories:/.test(src), 'the extension must be registered as an inline factory')
  assert.ok(/\[\.\.\.new Set\(\[\.\.\.tools, \.\.\.mcpToolNames\]\)\]/.test(src), 'the tools allowlist must include the mcp tool names')
})

test('the real seam: jiti loads pi-mcp-adapter and builds an isolated factory', async (t) => {
  // Only this test touches the real package — and it only CONSTRUCTS a
  // factory, it never registers it or connects a server.
  setMcpAdapterFactory(null)
  const r = await buildMcpExtension(entries, grant(['a']))
  assert.equal(typeof r.extension, 'function')
  assert.deepEqual(r.toolNames, ['mcp'])
})
