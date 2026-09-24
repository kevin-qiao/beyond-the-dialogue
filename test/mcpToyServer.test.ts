import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'

// The toy server is the fixture the manual harness (test/helpers/mcpHarness.ts)
// points a granted session at. Before anything can trust the harness's
// conclusion, the fixture must demonstrably SPEAK MCP to the very client
// library pi-mcp-adapter is built on — @modelcontextprotocol/client@2.0.0,
// the published-npm dependency that cleared gate T061. This test is that
// proof, and it is fully offline: the child process is a local `node`.
//
// What it does NOT prove (it can't, headless and keyless): the model
// actually choosing to call the tool. That loop is the harness's job, on a
// machine with a configured provider.

const SERVER = path.join(import.meta.dirname, 'helpers', 'mcpToyServer.mjs')

test('the toy MCP server completes the handshake and serves echo over stdio', async () => {
  const { Client } = await import('@modelcontextprotocol/client')
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio')

  const client = new Client({ name: 'wb-toy-check', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] })
  await client.connect(transport)
  try {
    const tools = await client.listTools()
    assert.deepEqual(
      tools.tools.map((t: { name: string }) => t.name),
      ['echo']
    )
    const result = await client.callTool({ name: 'echo', arguments: { message: 'beyond the dialogue' } })
    const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text
    assert.equal(text, 'echo: beyond the dialogue')
    assert.notEqual(result.isError, true)
  } finally {
    await client.close()
  }
})
