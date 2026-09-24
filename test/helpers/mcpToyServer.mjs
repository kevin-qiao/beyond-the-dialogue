// A tiny stdio MCP server for the harness — newline-delimited JSON-RPC 2.0,
// no dependencies, speaks just enough of the protocol for pi-mcp-adapter to
// list and call one tool: `echo`. Deliberately dumb so the harness proves
// exactly the wiring: server spawn → tool discovery → tool call → result →
// teardown. Not shipped; only read by test/helpers/mcpHarness.ts.
import * as readline from 'node:readline'

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

const TOOLS = [
  {
    name: 'echo',
    description: 'Returns back the message it is given, prefixed with "echo:".',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }
  }
]

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) return // notifications need no response
  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'echo-toy', version: '1.0.0' }
        }
      })
      break
    case 'tools/list':
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } })
      break
    case 'tools/call':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.message ?? '(none)'}` }],
          isError: false
        }
      })
      break
    case 'ping':
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
      break
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
  }
})
