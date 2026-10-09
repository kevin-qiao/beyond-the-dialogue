import type { DatabaseSync } from 'node:sqlite'
import { loadSettings } from './db'
import { getProviderKey } from './secrets'
import type { SettingsInput } from '../shared/types'

/**
 * The ONE place the secret is re-attached to the settings shape — and it is
 * attached, never read off the table: the values come from the machine-bound
 * store, so on a different machine the gated read yields nothing and the
 * app's answer to "is there a key?" becomes "there is no key here yet".
 *
 * This is the hydration the Pi runtime and the job handlers need
 * (`configureRuntimeFromSettings`, `testPrompt`, agent sessions). No IPC
 * payload, snapshot, or event ever uses the returned shape — `SettingsInput`
 * is secret-bearing by name, and the redaction layer takes its input from
 * `loadSettings`, not from here.
 */
export function loadRuntimeSettings(db: DatabaseSync): SettingsInput {
  const settings = loadSettings(db)
  const apiKey = settings.hasApiKey ? getProviderKey(settings.provider) : null
  return apiKey ? { ...settings, apiKey } : settings
}
