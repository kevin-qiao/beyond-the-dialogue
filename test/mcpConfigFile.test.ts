import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { setUserDataRoot, piMcpConfigPath } from '../src/main/paths'
import { materializeMcpConfig } from '../src/main/mcpConfigFile'
import { buildMcpSettingsJson } from '../src/core/domain/mcpConfig'

test('materialize writes the standard shape under the app agent dir, deterministically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mcpfile-'))
  setUserDataRoot(root)
  const entries = [
    { name: 'everything', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] } },
    { name: 'docs', config: { url: 'https://mcp.example.com/mcp', headers: { A: 'b' } } }
  ]
  materializeMcpConfig(entries)
  const file = piMcpConfigPath()
  assert.ok(file.startsWith(root))
  assert.equal(fs.readFileSync(file, 'utf-8'), buildMcpSettingsJson(entries))
  // Re-writing an unchanged list is byte-identical: no churn, no drift.
  materializeMcpConfig(entries)
  assert.equal(fs.readFileSync(file, 'utf-8'), buildMcpSettingsJson(entries))
  // It is a real JSON document an external tool can read.
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), {
    mcpServers: {
      everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
      docs: { url: 'https://mcp.example.com/mcp', headers: { A: 'b' } }
    }
  })
  // An empty list is still a valid, explicit empty document — not a stale file.
  materializeMcpConfig([])
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { mcpServers: {} })
})

test('mcp.json is written on save AND converged at startup', () => {
  // Both call-sites are load-bearing: save keeps the copy current, startup
  // heals a save that crashed between the commit and the write. Enforce by
  // source scan, in the repo's guard-test idiom.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf-8')
  assert.equal(
    (src.match(/materializeMcpConfig\(/g) ?? []).length,
    2,
    'materializeMcpConfig must be called in the settings:save handler and at startup'
  )
})
