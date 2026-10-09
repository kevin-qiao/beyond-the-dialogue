import * as fs from 'node:fs'
import * as os from 'node:os'
import { piAgentDir, piAuthPath, piSecretsPath } from './paths'

// The machine-bound secret store (feature 001, research D4).
//
// FR-020 as clarified: user-account-private files on the user's own machine
// only — no operating-system credential store. What this module adds to that
// is the honest copy story from FR-021/SC-008: the file records the machine
// it was written on, and on any other machine every value is treated as
// ABSENT, so the app asks for the secret again instead of shipping working
// credentials along with the folder.
//
// Main-process only: nothing here crosses IPC, nothing here logs a value, and
// the settings table no longer holds secret material at all. A plain
// filesystem file is I/O, which is why this is an adapter and not core —
// core reaches secret material only as values handed to it through ports.

export interface StoredSecrets {
  machineFingerprint: string
  /** Provider id → API key. */
  providerKeys: Record<string, string>
  /** MCP server name → env object. */
  mcpEnv: Record<string, Record<string, string>>
}

export const EMPTY_SECRETS: StoredSecrets = { machineFingerprint: '', providerKeys: {}, mcpEnv: {} }

// ---- machine fingerprint ----

// hostname + username: what "private to the user's own account on this
// machine" means in values BOTH targets provide. The POSIX numeric uid would
// be the natural pick on Linux, but it is unavailable on Windows
// (`os.userInfo().uid` is -1 there), and -1 + hostname is the same value for
// every account on a machine — a fingerprint that stops being one. The name
// is available everywhere and identifies the account just as well (Principle V).
export function machineFingerprint(): string {
  return `${os.hostname()}:${os.userInfo().username}`
}

// Test seam (same pattern as setSessionFactory): the mismatch case has to be
// produced, not lived through.
let fingerprintProvider: () => string = machineFingerprint
export function setMachineFingerprintProvider(fn: (() => string) | null): void {
  fingerprintProvider = fn ?? machineFingerprint
}

// ---- read / write ----

/**
 * Read the stored secrets, applying the fingerprint gate.
 *
 * A missing file, an unreadable file, a corrupt file, or a file written on a
 * different machine ALL answer the same way: `{ available: false }` with no
 * values. That is the FR-021 re-enter state — the app treats the secrets as
 * never having been copied here, rather than silently authenticating with
 * someone else's credentials.
 */
export function readSecrets(): { available: boolean; fingerprintMatches: boolean; secrets: StoredSecrets } {
  const absent = { available: false, fingerprintMatches: false, secrets: { ...EMPTY_SECRETS } }
  let raw: string
  try {
    raw = fs.readFileSync(piSecretsPath(), 'utf8')
  } catch {
    return absent
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return absent
  }
  const file = parsed as Partial<StoredSecrets>
  if (!file || typeof file !== 'object') return absent
  const fingerprintMatches = typeof file.machineFingerprint === 'string' && file.machineFingerprint === fingerprintProvider()
  if (!fingerprintMatches) {
    // The values exist but are NOT available: never hand back secrets that
    // were read off a fingerprint-gated file whose fingerprint disagreed.
    return { available: false, fingerprintMatches: false, secrets: { ...EMPTY_SECRETS } }
  }
  return {
    available: true,
    fingerprintMatches: true,
    secrets: {
      machineFingerprint: file.machineFingerprint ?? '',
      providerKeys: toStringRecord(file.providerKeys, undefined),
      mcpEnv: toStringEnvRecord(file.mcpEnv)
    }
  }
}

/** Write the whole store, mode 0600, keys sorted for a deterministic file. */
export function writeSecrets(secrets: StoredSecrets): void {
  const dir = piAgentDir()
  fs.mkdirSync(dir, { recursive: true })
  const file: StoredSecrets = {
    machineFingerprint: secrets.machineFingerprint || fingerprintProvider(),
    providerKeys: sortObject(secrets.providerKeys),
    mcpEnv: sortNested(secrets.mcpEnv)
  }
  fs.writeFileSync(piSecretsPath(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
}

// ---- typed readers for main-only consumers (T041) ----

/**
 * The stored key for a provider, or null when it is absent or this is not the
 * machine that stored it. Consumers that need the key call THIS, never
 * `readSecrets().secrets` directly, so the fingerprint gate cannot be bypassed
 * by forgetting to check it.
 */
export function getProviderKey(provider: string): string | null {
  const { available, secrets } = readSecrets()
  if (!available) return null
  return secrets.providerKeys[provider] ?? null
}

/** The stored env for one MCP server — empty when absent or not this machine. */
export function getMcpEnv(server: string): Record<string, string> {
  const { available, secrets } = readSecrets()
  if (!available) return {}
  return secrets.mcpEnv[server] ?? {}
}

/** Presence only — safe to surface (the settings table mirrors it as a flag). */
export function hasAnyProviderKey(): boolean {
  const { available, secrets } = readSecrets()
  return available && Object.values(secrets.providerKeys).some((k) => typeof k === 'string' && k !== '')
}

/** Merge one provider key into the store and write it back whole. */
export function storeProviderKey(provider: string, apiKey: string): void {
  const { secrets } = readSecrets()
  const next: StoredSecrets = {
    machineFingerprint: secrets.machineFingerprint || fingerprintProvider(),
    providerKeys: { ...secrets.providerKeys, [provider]: apiKey },
    mcpEnv: secrets.mcpEnv
  }
  writeSecrets(next)
}

/** Merge one server's env into the store and write it back whole. */
export function storeMcpEnv(server: string, env: Record<string, string>): void {
  const { secrets } = readSecrets()
  if (Object.keys(env).length === 0) return
  const next: StoredSecrets = {
    machineFingerprint: secrets.machineFingerprint || fingerprintProvider(),
    providerKeys: secrets.providerKeys,
    mcpEnv: { ...secrets.mcpEnv, [server]: env }
  }
  writeSecrets(next)
}

/**
 * Drop a stale plaintext provider key from the Pi runtime's own `auth.json`.
 *
 * The POC mirrored the key there (research Grounding), and the SDK reads that
 * file at its own initiative: after a folder copy it would authenticate
 * SILENTLY with the old plaintext and void SC-008's re-enter promise. So when
 * the gated read yields no key, the entry is removed before any runtime use
 * (T041a) — auth.json is an output materialized from the gated store, never a
 * second source of truth.
 */
// The file's shape belongs to the SDK: `Record<providerId, Credential>` where
// an api-key credential is `{ type: 'api_key', key?, env? }` — see
// @earendil-works/pi-ai `auth/types`. The app only ever removes, never
// writes, entries here. Returns null when nothing was removed, so the caller
// knows not to rewrite the file.
export function stripStaleAuthKey(authJson: Record<string, unknown>): Record<string, unknown> | null {
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [providerId, cred] of Object.entries(authJson)) {
    if (cred && typeof cred === 'object' && (cred as { type?: string }).type === 'api_key') {
      changed = true
      continue
    }
    next[providerId] = cred
  }
  return changed ? next : null
}

/**
 * The startup guard (T041a): remove the api_key entries from the SDK's own
 * `auth.json`. Call it whenever the gated store yields no key — otherwise a
 * copied folder would keep authenticating with plaintext the user never
 * re-entered. Returns true when anything was removed.
 *
 * A file we cannot parse is left alone: it is the SDK's own format, and
 * guessing at it would risk destroying something this module does not own.
 */
export function stripStaleAuthFile(): boolean {
  const file = piAuthPath()
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const stripped = stripStaleAuthKey(parsed as Record<string, unknown>)
  if (!stripped) return false
  try {
    fs.writeFileSync(file, JSON.stringify(stripped, null, 2) + '\n', { mode: 0o600 })
  } catch {
    return false
  }
  return true
}

// ---- small parse helpers (defensive against hand-edits) ----

function toStringRecord(value: unknown, _keep: undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

function toStringEnvRecord(value: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const env = toStringRecord(v, undefined)
      if (Object.keys(env).length > 0) out[k] = env
    }
  }
  return out
}

function sortObject(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!
  return out
}

function sortNested(obj: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const k of Object.keys(obj).sort()) out[k] = sortObject(obj[k]!)
  return out
}
