import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, loadSettings } from '../src/main/db'
import {
  getMcpEnv,
  getProviderKey,
  machineFingerprint,
  readSecrets,
  setMachineFingerprintProvider,
  stripStaleAuthFile,
  writeSecrets
} from '../src/main/secrets'
import { piAuthPath, piSecretsPath, setUserDataRoot } from '../src/main/paths'
import { toRedacted } from '../src/core/services/settingsService'

// The machine-bound secret store (feature 001, T038, research D4,
// FR-020/FR-021, SC-008). The fingerprint seam is the test hook that lets a
// single machine simulate the copy-to-another-machine case.

function tmpRoot(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-secrets-'))
  setUserDataRoot(dir)
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

afterEach(() => setMachineFingerprintProvider(null))

test('the file is written private to the user and never a directory-wide permission', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not the Windows mechanism; the account ACL is (quickstart §5 runs it natively)')
    return
  }
  const { dir } = tmpRoot()
  writeSecrets({ machineFingerprint: machineFingerprint(), providerKeys: { openai: 'sk-v' }, mcpEnv: {} })
  const mode = fs.statSync(piSecretsPath()).mode & 0o777
  assert.equal(mode, 0o600, 'user-account-private (FR-020)')
  // And the values are really there, under the data root (FR-021: one folder).
  assert.ok(fs.existsSync(path.join(dir, 'pi-agent', 'secrets.json')))
})

test('matching fingerprint ⇒ values available main-side; mismatch ⇒ every value absent (FR-021/SC-008)', () => {
  tmpRoot()
  writeSecrets({
    machineFingerprint: machineFingerprint(),
    providerKeys: { openai: 'sk-real' },
    mcpEnv: { jira: { TOKEN: 'tok' } }
  })

  assert.equal(getProviderKey('openai'), 'sk-real')
  assert.deepEqual(getMcpEnv('jira'), { TOKEN: 'tok' })

  // The same folder read by a different machine: absent, not "wrong".
  setMachineFingerprintProvider(() => 'other-machine:other-user')
  assert.equal(getProviderKey('openai'), null, 'the key is treated as never-stored-here')
  assert.deepEqual(getMcpEnv('jira'), {})
  assert.equal(readSecrets().available, false)
})

test('no redacted output ever contains a secret string', () => {
  const { dir } = tmpRoot()
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    ...loadSettings(conn.db),
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    mcpServers: [{ name: 'jira', config: { command: 'npx', args: ['-y', 'x'] } }]
  })
  const secret = 'sk-s3cr3t-n0t-t0-be-sh0wn'
  writeSecrets({ machineFingerprint: machineFingerprint(), providerKeys: { openai: secret }, mcpEnv: { jira: { TOKEN: 't0k3n' } } })

  const redacted = toRedacted(loadSettings(conn.db), readSecrets().secrets)
  const wire = JSON.stringify(redacted)
  assert.ok(!wire.includes(secret), 'the provider key is nowhere in the redacted shape')
  assert.ok(!wire.includes('t0k3n'), 'nor is any MCP env value')
  assert.equal(redacted.hasApiKey, true, 'presence is reported; value is not')
  assert.equal(redacted.mcpServers[0]!.hasEnv, true)
  conn.close()
})

test('a stale auth.json mirror is stripped when the gated store yields no key (T041a)', () => {
  tmpRoot()
  // Seed the POC's plaintext mirror in the SDK's own format.
  fs.mkdirSync(path.dirname(piAuthPath()), { recursive: true })
  fs.writeFileSync(
    piAuthPath(),
    JSON.stringify({ anthropic: { type: 'api_key', key: 'sk-old-plaintext' }, other: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } })
  )

  // On the machine that stored nothing for anthropic: the stale entry goes.
  assert.equal(getProviderKey('anthropic'), null)
  assert.equal(stripStaleAuthFile(), true)
  const after = JSON.parse(fs.readFileSync(piAuthPath(), 'utf-8'))
  assert.equal(after.anthropic, undefined, 'the plaintext api_key entry was removed')
  assert.ok(after.other, 'entries this module does not own are untouched')
  assert.equal(stripStaleAuthFile(), false, 'idempotent: nothing left to strip')

  // And while the gated store DOES hold a key, the guard is not run (the
  // startup rule: only strip when the store cannot hydrate).
  writeSecrets({ machineFingerprint: machineFingerprint(), providerKeys: { openai: 'sk-live' }, mcpEnv: {} })
  assert.equal(getProviderKey('openai'), 'sk-live')
})

test('a corrupt or foreign secrets file reads as absent, never as partial values', () => {
  tmpRoot()
  fs.mkdirSync(path.dirname(piSecretsPath()), { recursive: true })
  fs.writeFileSync(piSecretsPath(), '{ not json')
  assert.equal(readSecrets().available, false)
  assert.equal(getProviderKey('openai'), null)

  fs.writeFileSync(piSecretsPath(), JSON.stringify({ machineFingerprint: 'someone:else', providerKeys: { openai: 'sk-x' }, mcpEnv: {} }))
  assert.equal(readSecrets().available, false)
  assert.deepEqual(readSecrets().secrets.providerKeys, {}, 'the mismatched values are not even returned')
})
