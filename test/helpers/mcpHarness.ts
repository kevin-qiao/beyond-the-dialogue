// MANUAL end-to-end harness for `add-mcp-support`. Not part of `npm test`
// (no .test suffix) — it makes a REAL model call with the configured
// provider, so it runs only when a developer runs it:
//
//   npx tsx test/helpers/mcpHarness.ts
//
// What it proves, in one sitting, on a machine with a configured provider:
//
//   1. createJobSession + a granted typeDef constructs the REAL pi-mcp-adapter
//      from the in-memory snapshot (the jiti seam, not a scripted factory).
//   2. The session can see and call the `mcp` proxy tool: it spawns the toy
//      stdio server (test/helpers/mcpToyServer.mjs), lists its tools, calls
//      `echo`, and the result comes back in the reply.
//   3. session.dispose() tears the child process down (the session_shutdown
//      path — pgrep before/after).
//
// It never writes to the real database or settings: the server exists only in
// this process. It READS the app's pi-agent dir for provider auth — override
// the location with WB_DATA_ROOT if the default is wrong for your install.

import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { setUserDataRoot } from '../../src/main/paths'
import { DatabaseSync } from 'node:sqlite'

const dataRoot = process.env.WB_DATA_ROOT ?? path.join(os.homedir(), '.config', 'work-board')
setUserDataRoot(dataRoot)

const { createJobSession, setSessionFactory } = await import('../../src/main/ai/session-factory')
const { extractAssistantText } = await import('../../src/main/adapters/agent/sessionAdapter')
const { loadSettings } = await import('../../src/main/db')
const toy = path.join(import.meta.dirname, 'mcpToyServer.mjs')
const marker = `harness-ping-${Date.now()}`

// Read the developer's REAL settings (provider/model/apiKey) from the app DB
// so the harness drives the same configured provider the app uses. Opened
// read-only; nothing here writes to the database.
const db = new DatabaseSync(path.join(dataRoot, 'app.db'), { readOnly: true })
const real = loadSettings(db)
db.close()
if (!real.apiKey) {
  console.error(`no API key in ${dataRoot}/app.db — configure the app first, or set WB_DATA_ROOT`)
  process.exit(2)
}

const childAlive = () => {
  // The spawned server's exact command line is `<node> <fixture>`. pgrep -f
  // alone self-matches (the harness's args and even the pgrep shell carry the
  // fixture path), so match on the full command instead of a loose pattern.
  try {
    const out = execSync('pgrep -af .', { encoding: 'utf-8' })
    const wanted = `${process.execPath} ${toy}`
    const self = new Set([process.pid, process.ppid])
    return out
      .split('\n')
      .some((line) => {
        const pid = Number(line.split(/\s+/)[0])
        return line.includes(wanted) && !self.has(pid)
      })
  } catch {
    return false
  }
}

console.log(`data root: ${dataRoot}`)
console.log(`server:    node ${toy}`)
console.log(`marker:    ${marker}\n`)

const settings = {
  ...real,
  mcpServers: [{ name: 'echo-toy', config: { command: process.execPath, args: [toy] } }]
}

setSessionFactory(null) // the REAL path, not a scripted session
const { configureRuntimeFromSettings } = await import('../../src/main/ai/agent-runtime')
const cfg = await configureRuntimeFromSettings(settings)
if (!cfg.ok) {
  console.error('provider auth could not be applied to the runtime:', cfg.error)
  process.exit(2)
}
let session: Awaited<ReturnType<typeof createJobSession>> | null = null
let failed = false
try {
  session = await createJobSession({
    settings,
    cwd: os.tmpdir(),
    systemPrompt: 'You are a test harness. Use the mcp tool when told to. Answer in one short line.',
    thinkingLevel: 'low',
    tools: [],
    purpose: 'interactive',
    typeDef: { grants: { skills: [], toolServers: ['echo-toy'] } } as never
  })
  console.log('session built — prompting (real model call)…')
  await session.prompt(
    `You have a tool named "mcp". Call it with {"search": "echo"} to find tools, ` +
      `then call the echo tool with message "${marker}", then reply with exactly what the tool returned.`
  )
  const last = [...(session.messages as any[])].reverse().find((m) => m.role === 'assistant' && m.content?.length)
  const text = extractAssistantText(last)
  console.log(`assistant: ${text}`)
  if (!text.includes(marker)) {
    console.error(`\nFAIL: the reply does not contain the echo round-trip marker "${marker}"`)
    failed = true
  } else {
    console.log(`\nPASS: the echo marker came back through mcp → server → adapter → model.`)
  }
} catch (e) {
  console.error('FAIL:', e)
  failed = true
} finally {
  await session?.abort().catch(() => undefined)
  await session?.dispose?.().catch(() => undefined)
  // Give the shutdown handlers a beat, then check for the leaked child.
  await new Promise((r) => setTimeout(r, 2500))
  if (childAlive()) {
    console.error('FAIL: the MCP child process is still alive after dispose() — teardown is leaking')
    try {
      console.error(execSync(`pgrep -af ${JSON.stringify('mcpToyServer.mjs')}`, { encoding: 'utf-8' }))
    } catch { /* ignore */ }
    failed = true
  } else {
    console.log('child processes: none left after dispose (session_shutdown teardown OK)')
  }
}
process.exit(failed ? 1 : 0)
