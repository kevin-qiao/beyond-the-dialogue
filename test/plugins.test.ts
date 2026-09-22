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
    skills: [{ name: 'web-search', description: 'Search the web', path: '/skills/web-search' }],
    mcpServers: [{ name: 'jira', config: { command: 'npx', args: ['-y', 'atlassian-mcp'], env: { TOKEN: 'x' } } }]
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
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: [],
    ...partial
  }
}

test('skills validation: unique names, path required (description optional)', () => {
  assert.deepEqual(validatePluginEntries(settings({ skills: [{ name: 'a', description: 'does a', path: '/skills/a' }] })), [])
  assert.deepEqual(validatePluginEntries(settings({ skills: [{ name: 'a', description: '', path: '' }] })), [
    { key: 'plugin.skill.pathRequired', params: { name: 'a' } }
  ])
  assert.ok(
    validatePluginEntries(
      settings({ skills: [{ name: 'a', description: 'x', path: '/s/a' }, { name: 'a', description: 'y', path: '/s/b' }] })
    ).some((e) => e.key === 'plugin.skill.nameUnique')
  )
})

test('MCP validation: unique names, exactly one transport, typed standard fields', () => {
  // stdio — and a remote server, which the old stdio-only rule refused.
  assert.deepEqual(
    validatePluginEntries(
      settings({
        mcpServers: [
          { name: 'jira', config: { command: 'npx', args: ['-y', 'atlassian-mcp'] } },
          { name: 'docs', config: { url: 'https://mcp.example.com/mcp', headers: { AUTH: 'x' } } }
        ]
      })
    ),
    []
  )
  // Adapter fields the app does not interpret pass through untouched.
  assert.deepEqual(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: { command: 'x', lifecycle: 'eager', directTools: true, includeTools: ['t'] } }] })),
    []
  )
  // No transport at all.
  assert.deepEqual(validatePluginEntries(settings({ mcpServers: [{ name: 'jira', config: {} }] })), [
    { key: 'plugin.mcp.transportAmbiguous', params: { name: 'jira' } }
  ])
  // Two transports at once.
  assert.deepEqual(validatePluginEntries(settings({ mcpServers: [{ name: 'x', config: { command: 'a', url: 'b' } }] })), [
    { key: 'plugin.mcp.transportAmbiguous', params: { name: 'x' } }
  ])
  // A transport present but not a non-empty string.
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'jira', config: { command: '' } }] })).some(
      (e) => e.key === 'plugin.mcp.transportAmbiguous'
    )
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'jira', config: { command: 5 } }] })).some(
      (e) => e.key === 'plugin.mcp.transportAmbiguous'
    )
  )
  assert.ok(
    validatePluginEntries(
      settings({ mcpServers: [{ name: 'a', config: { command: 'x' } }, { name: 'a', config: { command: 'y' } }] })
    ).some((e) => e.key === 'plugin.mcp.nameUnique')
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: { command: 'x', args: 'not-a-list' } }] })).some(
      (e) => e.key === 'plugin.mcp.argsNotList'
    )
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: { command: 'x', env: ['A'] } }] })).some(
      (e) => e.key === 'plugin.mcp.envNotMap'
    )
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: { command: 'x', headers: { A: 1 } } }] })).some(
      (e) => e.key === 'plugin.mcp.headersNotMap'
    )
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: { command: 'x', cwd: 1 } }] })).some(
      (e) => e.key === 'plugin.mcp.cwdNotString'
    )
  )
  assert.ok(
    validatePluginEntries(settings({ mcpServers: [{ name: 'a', config: null as never }] })).some(
      (e) => e.key === 'plugin.mcp.configNotObject'
    )
  )
})

test('v9 migration: the stdio transport envelope becomes the standard config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mig9-'))
  const db = openDB(dir)
  migrate(db.db)
  const legacy = JSON.stringify([
    { name: 'jira', transport: { type: 'stdio', command: 'npx', args: ['-y', 'atlassian-mcp'], env: { TOKEN: 'x' } } },
    { name: 'kept', config: { url: 'https://x/mcp' } },
    { name: 'dropped', transport: { type: 'http', url: 'z' } }
  ])
  db.db.prepare("INSERT INTO settings (key,value) VALUES ('mcpServers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(legacy)
  // Make the database pretend v9 has not run yet: this is exactly the state a
  // v8-era database presents to the new code.
  db.db.prepare('DELETE FROM schema_migrations WHERE version = 9').run()
  migrate(db.db)
  const rows = db.db.prepare("SELECT value FROM settings WHERE key = 'mcpServers'").get() as { value: string }
  assert.deepEqual(JSON.parse(rows.value), [
    { name: 'jira', config: { command: 'npx', args: ['-y', 'atlassian-mcp'], env: { TOKEN: 'x' } } },
    { name: 'kept', config: { url: 'https://x/mcp' } },
    { name: 'dropped', transport: { type: 'http', url: 'z' } }
  ])
  // Idempotent: re-running migrate with v9 marked changes nothing further.
  migrate(db.db)
  const rows2 = db.db.prepare("SELECT value FROM settings WHERE key = 'mcpServers'").get() as { value: string }
  assert.equal(rows2.value, rows.value)
  const version = db.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 9').get() as { n: number }
  assert.equal(version.n, 1)
  db.db.close()
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
