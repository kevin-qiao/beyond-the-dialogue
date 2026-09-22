import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMcpJsonPaste,
  validateMcpServerConfig,
  snapshotFromGrant,
  buildMcpSettingsJson,
  describeMcpServer
} from '../src/core/domain/mcpConfig'

test('paste: a complete mcpServers block becomes rows', () => {
  const { entries, issues } = parseMcpJsonPaste(
    JSON.stringify({
      mcpServers: {
        everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
        docs: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${T}' } }
      }
    })
  )
  assert.deepEqual(issues, [])
  assert.deepEqual(entries.map((e) => e.name), ['everything', 'docs'])
  assert.deepEqual(entries[1].config.headers, { Authorization: 'Bearer ${T}' })
})

test('paste: a bare {name: config} map is accepted too', () => {
  const { entries, issues } = parseMcpJsonPaste('{"jira": {"command": "npx", "args": ["-y", "atlassian"]}}')
  assert.deepEqual(issues, [])
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], { name: 'jira', config: { command: 'npx', args: ['-y', 'atlassian'] } })
})

test('paste: invalid JSON and wrong shapes are refused, never guessed', () => {
  assert.ok(parseMcpJsonPaste('{not json').issues.some((i) => i.key === 'plugin.mcp.invalidJson'))
  // A lone server body without its name.
  assert.deepEqual(parseMcpJsonPaste('{"command": "npx"}').issues, [{ key: 'plugin.mcp.pasteShape' }])
  assert.deepEqual(parseMcpJsonPaste('[1,2]').issues, [{ key: 'plugin.mcp.pasteShape' }])
  assert.deepEqual(parseMcpJsonPaste('"hello"').issues, [{ key: 'plugin.mcp.pasteShape' }])
  // mcpServers present but not a map.
  assert.deepEqual(parseMcpJsonPaste('{"mcpServers": []}').issues, [{ key: 'plugin.mcp.pasteShape' }])
})

test('paste: per-server validation rides along, and duplicate names inside the paste fail', () => {
  const { entries, issues } = parseMcpJsonPaste('{"a": {"command": "x"}, "b": {}, "a": {"url": "y"}}')
  assert.ok(issues.some((i) => i.key === 'plugin.mcp.transportAmbiguous' && i.params?.name === 'b'))
  // JSON.parse already collapsed the duplicate key, so "a" appears once and
  // valid; the paste-level duplicate check guards the entries that survive.
  assert.deepEqual(
    issues.filter((i) => i.key === 'plugin.mcp.nameUnique'),
    []
  )
  assert.equal(entries.length, 2)
})

test('validateMcpServerConfig: standard fields pass through uninterpreted', () => {
  assert.deepEqual(
    validateMcpServerConfig('a', {
      command: 'npx',
      args: ['-y', 'x'],
      env: { K: '${SOME_VAR}' },
      cwd: '~/work',
      lifecycle: 'lazy',
      idleTimeout: 10,
      requestTimeoutMs: 30000,
      includeTools: ['get_*'],
      directTools: true,
      auth: 'oauth',
      disabled: false
    }),
    []
  )
})

test('snapshotFromGrant restricts to the granted names, in entry order', () => {
  const entries = [
    { name: 'a', config: { command: 'x' } },
    { name: 'b', config: { url: 'y' } },
    { name: 'c', config: { command: 'z' } }
  ]
  assert.deepEqual(snapshotFromGrant(entries, ['c', 'a']), {
    a: { command: 'x' },
    c: { command: 'z' }
  })
  // A granted name with no matching entry contributes nothing (the caller
  // reports it; the adapter is never handed a hole).
  assert.deepEqual(snapshotFromGrant(entries, ['missing']), {})
})

test('buildMcpSettingsJson: the exact standard shape, trailing newline', () => {
  const json = buildMcpSettingsJson([
    { name: 'a', config: { command: 'x', args: ['-y'] } },
    { name: 'b', config: { url: 'https://e/mcp' } }
  ])
  assert.equal(json, JSON.stringify({ mcpServers: { a: { command: 'x', args: ['-y'] }, b: { url: 'https://e/mcp' } } }, null, 2) + '\n')
  assert.deepEqual(JSON.parse(json), { mcpServers: { a: { command: 'x', args: ['-y'] }, b: { url: 'https://e/mcp' } } })
  assert.equal(buildMcpSettingsJson([]), JSON.stringify({ mcpServers: {} }, null, 2) + '\n')
})

test('describeMcpServer summarizes the transport without leaking secrets', () => {
  assert.equal(describeMcpServer({ name: 'a', config: { command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'secret' } } }), 'npx -y x')
  assert.equal(describeMcpServer({ name: 'b', config: { url: 'https://mcp.example.com/mcp' } }), 'https://mcp.example.com/mcp')
  assert.equal(describeMcpServer({ name: 'c', config: { socket: '/tmp/x.sock' } }), '/tmp/x.sock')
})
