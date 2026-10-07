import type { Settings } from '../../shared/types'

// Configuration predicate, in the domain rather than next to the SDK.
//
// Pure and dependency-free, so it is importable from the renderer (the
// "AI not configured" indicator), from services deciding whether a run is
// worth enqueuing, and from any future host. The name is deliberately not
// "isAiConfigured": it answers "is this app configured enough to do AI work",
// which is what every caller actually asks.
//
// Feature 001 changed WHICH field answers this: from migration v10 on the
// Settings shape carries `hasApiKey` — the presence of a stored secret —
// because the secret itself lives in the machine-bound store and must not
// reach the domain at all. Presence, never the value.

export function isConfigured(settings: Pick<Settings, 'provider' | 'model' | 'hasApiKey'>): boolean {
  return !!(settings.hasApiKey && settings.model && settings.provider)
}

/**
 * The three declared readiness states (FR-016, data-model "Model-service
 * configuration"). One pure rule, read by the board and the settings card
 * alike.
 *
 * A configured-but-never-verified service reads as `not-configured`: the
 * board says what the USER can rely on, and an unverified configuration is
 * not yet something to rely on — that is precisely what SC-004's first-run
 * verification closes. The raw `{ never-checked | ok | failed(reason) }`
 * record stays on `settings.lastCheck` for the Settings panel to show.
 */
export type AiReadiness = 'not-configured' | 'configured-verified' | 'configured-last-check-failed'

export function aiReadiness(
  settings: Pick<Settings, 'provider' | 'model' | 'hasApiKey' | 'lastCheck'>
): AiReadiness {
  if (!isConfigured(settings)) return 'not-configured'
  if (settings.lastCheck?.state === 'failed') return 'configured-last-check-failed'
  if (settings.lastCheck?.state === 'ok') return 'configured-verified'
  return 'not-configured'
}
