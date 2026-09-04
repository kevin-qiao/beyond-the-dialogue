import type { Settings } from '../../shared/types'

// Pure helpers that don't touch the Pi SDK, so they can be imported in any
// context (renderer, tests, main) without loading ESM-only agent packages.

export function isConfigured(settings: Settings): boolean {
  return !!(settings.apiKey && settings.model && settings.provider)
}
