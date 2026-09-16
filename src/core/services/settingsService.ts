import type { Settings } from '../../shared/types'
import type { StoragePort } from '../ports/storage'
import { validatePluginEntries } from '../domain/plugins'
import { LocalizedError } from '../i18n/issues'

// Settings use case: validate, then persist.
//
// The handler this replaces did the validation inline, next to the Electron
// transport. The rule is unchanged; it is now reachable from a test.

export function saveSettings(storage: StoragePort, settings: Settings): Settings {
  const pluginErrors = validatePluginEntries(settings)
  if (pluginErrors.length > 0) throw new LocalizedError(pluginErrors)
  // Configuring an API key counts as completing first-run setup, so the
  // welcome screen does not reappear for a user who has already set one.
  const next: Settings = settings.apiKey ? { ...settings, showWelcome: false } : settings
  storage.saveSettings(next)
  return storage.loadSettings()
}
