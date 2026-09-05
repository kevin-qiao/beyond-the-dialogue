import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { validatePluginEntries } from '../src/main/plugins'
import { openDB, migrate, saveSettings, loadSettings } from '../src/main/db'
import type { Settings } from '../src/shared/types'

test('7.1 skills/MCP persist with settings and reload intact (AppSnapshot source of truth)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-plugins-'))
  const db = openDB(dir)
  migrate(db.db)
  const s = settings({
    skills: [{ name: 'web-search', description: 'Search the web' }],
    mcpServers: [{ name: 'jira', transport: { type: 'stdio', command: 'npx', args: ['-y', 'atlassian-mcp'], env: { TOKEN: 'x' } } }]
  })
  saveSettings(db.db, s)
  const back = loadSettings(db.db)
  assert.deepEqual(back.skills, s.skills)
  assert.deepEqual(back.mcpServers, s.mcpServers)
  // Corrupt JSON degrades to empty lists, never a crash.
  db.db.prepare("INSERT INTO settings (key,value) VALUES ('mcpServers','{not json') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  assert.deepEqual(loadSettings(db.db).mcpServers, [])
  db.close()
})

function settings(partial: Partial<Settings>): Settings {
  return {
    provider: 'openai',
    model: '',
    apiKey: null,
    wikiPath: '',
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: [],
    ...partial
  }
}

test('skills validation: unique names, description required', () => {
  assert.deepEqual(validatePluginEntries(settings({ skills: [{ name: 'a', description: 'does a' }] })), [])
  assert.ok(validatePluginEntries(settings({ skills: [{ name: 'a', description: '' }] })).some((e) => /description is required/.test(e)))
  assert.ok(
    validatePluginEntries(settings({ skills: [{ name: 'a', description: 'x' }, { name: 'a', description: 'y' }] })).some((e) => /unique/.test(e))
  )
})

test('MCP validation: unique names, complete stdio transport', () => {
  assert.deepEqual(
    validatePluginEntries(settings({ mcpServers: [{ name: 'jira', transport: { type: 'stdio', command: 'npx', args: ['-y', 'atlassian-mcp'] } }] })),
    []
  )
  assert.ok(validatePluginEntries(settings({ mcpServers: [{ name: 'jira', transport: { type: 'stdio', command: '' } }] })).some((e) => /command is required/.test(e)))
  assert.ok(validatePluginEntries(settings({ mcpServers: [{ name: 'a', transport: { type: 'stdio', command: 'x' } }, { name: 'a', transport: { type: 'stdio', command: 'y' } }] })).some((e) => /unique/.test(e)))
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'remote', transport: { type: 'http', command: '' } as never }] })).some((e) => /unsupported transport/.test(e))
  )
})

test('7.3 managed skills/MCP are provably inert on the agent path (design D6)', () => {
  // No module on the agent path reads the managed collections — future grant
  // wiring is gated behind add-mcp-support. Enforce by source scan: the only
  // references to settings .skills/.mcpServers must live outside the runtime.
  const agentPath = [
    'src/main/ai/session-factory.ts',
    'src/main/ai/agent-runtime.ts',
    'src/main/ai/chat.ts',
    'src/main/ai/triggers.ts',
    'src/main/preprocess.ts',
    'src/main/suggestions.ts',
    'src/main/wiki/ingest.ts',
    'src/main/wiki/wiki.ts',
    'src/main/job-queue.ts'
  ]
  const usage = /\bsettings\.(skills|mcpServers)\b/
  for (const rel of agentPath) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
    assert.equal(usage.test(src), false, `${rel} must not read managed skills/MCP in v0.8`)
  }
})
