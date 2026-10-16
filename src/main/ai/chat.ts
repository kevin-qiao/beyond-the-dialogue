import type { ChatMessage, SettingsInput } from '../../shared/types'
import { isConfigured } from './ai-config'
import { message } from '../../core/i18n'

// The conversation turn runner (feature 002, research D5).
//
// The POC kept an in-memory ChatSession per panel: the transcript died with
// the process, which is exactly what FR-009 forbids. Storage now holds the
// history (the v14 tables), and this module is what remains of "a session":
// ONE short-lived model call per turn. Nothing is retained between turns —
// no open session idles while the panel is closed, so there is no resource to
// dispose; the standing dispose rule belongs to agent sessions with
// extensions, and a conversation turn resolves NO_GRANT and constructs none
// (D9). The history arrives already shaped by the service (stored turns +
// grounding, assistant entries carrying their stored usage — the
// chatMessages rule), and the reply returns with the usage the provider
// reported so the NEXT turn's history satisfies the SDK's estimator.
//
// The stream function is injectable so tests can script turns without a
// provider; the default lazily imports agent-runtime (which statically
// imports the ESM-only Pi SDK), keeping this module loadable in the CJS test
// context — the same pattern as session-factory.ts.

export type ChatStreamFn = (
  settings: SettingsInput,
  history: ChatMessage[],
  onDelta: (delta: string) => void
) => Promise<{ text: string; usage?: Record<string, unknown> | null }>

async function defaultStream(
  settings: SettingsInput,
  history: ChatMessage[],
  onDelta: (delta: string) => void
): Promise<{ text: string; usage?: Record<string, unknown> | null }> {
  const { streamChat } = await import('./agent-runtime')
  return streamChat(settings, history, onDelta)
}

let streamOverride: ChatStreamFn | null = null

/** Test seam: script the turn transport without a provider. */
export function setChatStreamFn(fn: ChatStreamFn | null): void {
  streamOverride = fn
}

export interface ChatTurnResult {
  text: string
  usage?: Record<string, unknown> | null
}

/**
 * Run one conversation turn. Rejects when the model is not configured or the
 * provider fails; the caller (the conversation service) keeps the stored
 * history intact and reports the failure honestly.
 */
export async function runChatTurn(
  settings: SettingsInput,
  history: ChatMessage[],
  onDelta: (delta: string) => void,
  streamFn: ChatStreamFn = streamOverride ?? defaultStream
): Promise<ChatTurnResult> {
  if (!isConfigured(settings)) {
    throw new Error(message(settings.uiLanguage, 'error.aiNotConfigured'))
  }
  return streamFn(settings, history, onDelta)
}
