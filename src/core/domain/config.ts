import type { Settings } from '../../shared/types'

// Configuration predicate, in the domain rather than next to the SDK.
//
// Pure and dependency-free, so it is importable from the renderer (the
// "AI not configured" indicator), from services deciding whether a run is
// worth enqueuing, and from any future host. The name is deliberately not
// "isAiConfigured": it answers "is this app configured enough to do AI work",
// which is what every caller actually asks.

export function isConfigured(settings: Pick<Settings, 'provider' | 'model' | 'apiKey'>): boolean {
  return !!(settings.apiKey && settings.model && settings.provider)
}
