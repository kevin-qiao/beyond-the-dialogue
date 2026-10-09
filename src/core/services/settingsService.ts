import type { RedactedMcpEntry, RedactedSettings, Settings, SettingsInput, StoredSecrets } from '../../shared/types'
import type { StoragePort } from '../ports/storage'
import { validatePluginEntries } from '../domain/plugins'
import { LocalizedError } from '../i18n/issues'

// Settings use cases: validate and persist, and the two pure rules that keep
// secrets out of every boundary the settings cross (feature 001, research D4,
// FR-020).
//
// Both rules are PURE over the ports — they take the values in and return
// values, never touching the secret store — which is what lets a headless test
// pin them (Principle IV) and what makes the redaction structural: `Settings`
// has no field a secret could be put into, so nothing downstream can leak one.

/**
 * The one write path: validate, persist, and return what was stored.
 *
 * The input may carry secret material (`SettingsInput`); the persisted shape
 * never does — the caller stores the secrets through the secret port BEFORE
 * handing the (presence-flagged) settings here, so a secret has no route into
 * the settings table even by accident.
 */
export function saveSettings(storage: StoragePort, settings: Settings): Settings {
  const pluginErrors = validatePluginEntries(settings)
  if (pluginErrors.length > 0) throw new LocalizedError(pluginErrors)
  // Configuring an API key counts as completing first-run setup, so the
  // welcome screen does not reappear for a user who has already set one.
  const next: Settings = settings.hasApiKey ? { ...settings, showWelcome: false } : settings
  storage.saveSettings(next)
  return storage.loadSettings()
}

/**
 * The redacted view: Settings minus nothing (it already carries no secret)
 * plus per-server env presence, so the Settings form can say "stored" without
 * the value. A server whose env lives in the secret store reads `hasEnv:
 * true`; one the user never gave env values reads false.
 */
export function toRedacted(settings: Settings, stored: StoredSecrets): RedactedSettings {
  const mcpServers: RedactedMcpEntry[] = settings.mcpServers.map((s) => ({
    name: s.name,
    config: { ...s.config },
    hasEnv: Object.keys(stored.mcpEnv?.[s.name] ?? {}).length > 0
  }))
  return { ...settings, mcpServers }
}

export interface SplitInputResult {
  /** The shape the settings table may hold — presence flags, no values. */
  settings: Settings
  /**
   * Secret material to merge into the store, keyed as the store keys it.
   * A provider key entry is present ONLY when the payload carried one:
   * absent means "keep existing" (FR-020 — never "clear by re-save"), and
   * this function never returns an instruction to delete.
   */
  secrets: {
    providerKey?: { provider: string; value: string }
    /** Env to merge per server; only servers whose payload carried env. */
    mcpEnv: Record<string, Record<string, string>>
  }
}

/**
 * Split a write-only save payload into the two stores it feeds.
 *
 * The contract rule, implemented once: "Secret fields present in payload ⇒
 * store them; absent/empty ⇒ keep existing (never 'clear by re-save')." A
 * provider key arrives as `settings.apiKey` (an optional field on
 * `SettingsInput`); MCP env values arrive inside each pasted server's
 * `config.env`, because that is the standard shape the user pastes.
 *
 * The stored secrets that are NOT re-supplied pass through untouched — the
 * caller merges them back in when it writes, so this function cannot erase a
 * secret by omission and the test for "save twice, key survives" has teeth.
 */
export function splitInput(input: SettingsInput, existing: StoredSecrets): SplitInputResult {
  const providerKey =
    typeof input.apiKey === 'string' && input.apiKey.trim() !== ''
      ? { provider: input.provider, value: input.apiKey }
      : undefined

  const mcpEnv: Record<string, Record<string, string>> = {}
  const servers: Settings['mcpServers'] = []
  for (const s of input.mcpServers ?? []) {
    const env = (s.config as Record<string, unknown> | undefined)?.env
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const entries: Record<string, string> = {}
      for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        if (typeof v === 'string') entries[k] = v
      }
      if (Object.keys(entries).length > 0) mcpEnv[s.name] = entries
    }
    // The persisted row never carries env — the store owns it.
    const { env: _env, ...rest } = (s.config ?? {}) as Record<string, unknown>
    servers.push({ ...s, config: rest })
  }

  // Presence, not value: a payload key ⇒ true; otherwise the existing row's
  // presence stands (never cleared by re-save), or the store already holds one.
  const hasApiKey = providerKey ? true : input.hasApiKey || Object.keys(existing.providerKeys).length > 0

  const settings: Settings = {
    ...input,
    hasApiKey,
    mcpServers: servers
  }
  delete (settings as Partial<SettingsInput>).apiKey
  return { settings, secrets: { providerKey, mcpEnv } }
}
