import * as path from 'node:path'
import * as os from 'node:os'

// Central location for app-private paths. Everything the app writes lives
// under userData; the wiki path is the single user-configurable exception.

let rootOverride: string | null = null

// Tests (and any non-Electron context) can point the app root elsewhere.
export function setUserDataRoot(root: string): void {
  rootOverride = root
}

export function userDataDir(): string {
  if (rootOverride) return rootOverride
  const { app } = require('electron') as typeof import('electron')
  return app.getPath('userData')
}

// The database FILENAME is declared once here. `openDB` used to join
// 'app.db' itself while this function computed the same value independently —
// the same path derived in two places, which Principle VI forbids and which
// drifts the moment either side changes.
export const DB_FILENAME = 'app.db'

/** The database path for a given data directory. */
export function dbPathIn(dataDir: string): string {
  return path.join(dataDir, DB_FILENAME)
}

/** The database path under the app's user data root. */
export function appDbPath(): string {
  return dbPathIn(userDataDir())
}

export function settingsPath(): string {
  return path.join(userDataDir(), 'settings.json')
}

export function vaultDir(): string {
  return path.join(userDataDir(), 'vault')
}

// Application-owned copies of user attachments (feature 001, FR-003/FR-021).
// The directory lives under the data root so the folder-copy portability
// story carries them; rows reference them by a path RELATIVE to this root,
// never absolutely — an absolute path would survive the copy as a dead link.
export function attachmentsDir(): string {
  return path.join(userDataDir(), 'attachments')
}

export function notesDir(): string {
  return path.join(vaultDir(), 'notes')
}

export function piAgentDir(): string {
  return path.join(userDataDir(), 'pi-agent')
}

export function piAuthPath(): string {
  return path.join(piAgentDir(), 'auth.json')
}

// The machine-bound secret store (feature 001, research D4, FR-020): the
// provider keys and MCP env values that migration v10 moved OUT of the
// settings table. Written mode 0600, read by main only, never logged, and
// gated by a machine fingerprint so a copied data folder treats them as
// absent and asks again (FR-021/SC-008). Derived here, beside auth.json,
// because every app-private file under userData is named in this module.
export function piSecretsPath(): string {
  return path.join(piAgentDir(), 'secrets.json')
}

export function piModelsPath(): string {
  return path.join(piAgentDir(), 'models.json')
}

// The app-owned MCP config file, in the standard `{"mcpServers": {...}}`
// shape. It is an OUTPUT: the Settings rows are the source of truth and this
// file is rewritten from them (src/main/mcpConfigFile.ts). The agent runtime
// is never pointed here — sessions receive an in-memory isolated config
// snapshot built from the rows (contracts/plugin-grants.md §5) — so this path
// is for user inspection and external-tool interop, and must live beside
// auth.json/models.json under userData, never in a global config location.
export function piMcpConfigPath(): string {
  return path.join(piAgentDir(), 'mcp.json')
}

export function skillsDir(): string {
  return path.join(userDataDir(), 'skills')
}

// The default destination for the Meeting type's minutes: a plain folder under
// the user's documents. The user can re-point it per type in Settings; this is
// only the initial value. Note the wiki has NO such default — a `store: wiki`
// destination carries its own rootPath, declared per type, and a type without
// one is refused rather than pointed at a built-in path.
export function defaultMeetingMinutesPath(): string {
  return path.join(os.homedir(), 'Documents', 'WorkBoard-Meeting-Minutes')
}
