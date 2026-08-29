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

export function appDbPath(): string {
  return path.join(userDataDir(), 'app.db')
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

export function analysesDir(): string {
  return path.join(vaultDir(), 'analyses')
}

export function pdfsDir(): string {
  return path.join(vaultDir(), 'pdfs')
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

export function defaultWikiPath(): string {
  return path.join(os.homedir(), 'Documents', 'WorkBoard-Wiki')
}
