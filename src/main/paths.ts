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

export function notesDir(): string {
  return path.join(vaultDir(), 'notes')
}

export function piAgentDir(): string {
  return path.join(userDataDir(), 'pi-agent')
}

export function piAuthPath(): string {
  return path.join(piAgentDir(), 'auth.json')
}

export function piModelsPath(): string {
  return path.join(piAgentDir(), 'models.json')
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
