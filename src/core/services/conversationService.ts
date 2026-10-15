import type { ChatMessage, Conversation, ConversationMessage } from '../../shared/types'
import type { ConversationStorePort, ConversationTurnPort } from '../ports/conversations'
import { buildChatContext } from '../domain/chatContext'
import { buildSessionContext } from '../domain/grant'
import { message, type Language } from '../i18n'
import { LocalizedError } from '../i18n/issues'

// The conversation use cases (feature 002, US2): list, start, read, send one
// turn, delete. Conversations belong to a task, survive restarts because the
// storage — not memory — holds them (FR-009), and never act on the board:
// this service receives NO task port, only the read-only material its store
// assembles for grounding (FR-010, structural).
//
// A turn is one short-lived model call (D5): the stored history plus the task
// grounding go out, deltas stream back, both messages are stored, and nothing
// is retained afterwards. A failed send stores no assistant turn and reports
// the error honestly — the stored history stays intact.

export interface ConversationDeps {
  store: ConversationStorePort
  turn: ConversationTurnPort
  /** The language refusals and stated reasons are phrased in. */
  language: Language
}

export type SendOutcome =
  | { ok: true; message: ConversationMessage }
  | { ok: false; error: string; reason?: 'off' | 'not-configured' | 'failed' }

export interface SendHooks {
  /** Live deltas as they stream (the transport rebroadcasts them). */
  onDelta?: (delta: string) => void
  /** Announced for EVERY stored message — the user's, then the assistant's —
   *  so the transport emits `conversation.updated` per stored turn and no
   *  delta is ever shown without the stored message behind it. */
  onStored?: (message: ConversationMessage) => void
}

export function listConversations(store: ConversationStorePort, taskId: string): Conversation[] {
  return store.listForTask(taskId)
}

export function createConversation(store: ConversationStorePort, taskId: string): Conversation {
  // A conversation of a task that does not exist is a bug, not a user path;
  // the material check makes it a loud error rather than an FK surprise.
  if (!store.taskMaterial(taskId)) throw new Error('task not found')
  return store.create(taskId)
}

export function listMessages(store: ConversationStorePort, conversationId: string): ConversationMessage[] {
  return store.messagesFor(conversationId)
}

export function deleteConversation(store: ConversationStorePort, conversationId: string): void {
  store.delete(conversationId)
}

/**
 * Send one turn. Ordering is the honesty part: the user's message is stored
 * BEFORE the call (it is a record of what they asked, whatever the provider
 * then does), and the assistant's message is stored only after its text
 * arrived — a failed send therefore leaves the history intact plus the
 * unanswered question, and the outcome says what happened.
 */
export async function sendTurn(
  deps: ConversationDeps,
  args: { conversationId: string; content: string },
  hooks: SendHooks = {}
): Promise<SendOutcome> {
  const content = args.content.trim()
  if (!content) throw new LocalizedError([{ key: 'conversation.emptyMessage' }])

  const conversation = deps.store.get(args.conversationId)
  if (!conversation) throw new Error('conversation not found')
  const material = deps.store.taskMaterial(conversation.taskId)
  if (!material) throw new Error('task not found')

  // The unavailable state is STATED, not thrown (US2-AC3): the surface shows
  // the reason and the rest of the board is unaffected. No call is made.
  const availability = deps.turn.availability()
  if (availability !== 'ready') {
    return {
      ok: false,
      reason: availability,
      error: message(
        deps.language,
        availability === 'off' ? 'conversation.unavailable.off' : 'conversation.unavailable.notConfigured'
      )
    }
  }

  // The grounding block is built at context CONSTRUCTION from this task's own
  // material only (FR-011); the egress wrapper is the same boundary every
  // session path uses.
  const grounding = buildSessionContext({
    task: material.task,
    purpose: 'interactive',
    fullContext: () =>
      buildChatContext(material.typeDef, {
        task: material.task,
        typeDef: material.typeDef,
        workingContent: material.workingContent
      })
  })

  const history = shapeHistory(deps.store.messagesFor(conversation.id), grounding)

  const userMessage = deps.store.appendMessage(conversation.id, { role: 'user', content })
  hooks.onStored?.(userMessage)

  try {
    const reply = await deps.turn.run({
      history: [...history, { role: 'user', content }],
      onDelta: (delta) => hooks.onDelta?.(delta)
    })
    const assistantMessage = deps.store.appendMessage(conversation.id, {
      role: 'assistant',
      content: reply.text,
      usage: reply.usage ?? null
    })
    hooks.onStored?.(assistantMessage)
    return { ok: true, message: assistantMessage }
  } catch (e: any) {
    // Honest reporting: the stored history is intact, the outcome names the
    // failure. Nothing is retried behind the user's back.
    return { ok: false, reason: 'failed', error: e?.message ?? String(e) }
  }
}

/**
 * The stored turns as the model-call history, with the grounding pair ahead
 * of them (the shape the old panel captured on its first message — now built
 * per turn, so the grounding always reflects the task as it stands).
 *
 * Assistant entries carry their stored usage: the chatMessages rule — an
 * assistant entry without one makes the SDK's context estimator throw inside
 * the provider call, which surfaces as a reply that silently never appears.
 */
export function shapeHistory(stored: readonly ConversationMessage[], grounding: string | undefined): ChatMessage[] {
  const out: ChatMessage[] = []
  if (grounding && grounding.trim()) {
    out.push({ role: 'user', content: `Task context for this conversation (answer grounded in it):\n\n${grounding}` })
    out.push({ role: 'assistant', content: 'Understood — I have the task context. Ask me anything.' })
  }
  for (const m of stored) {
    out.push(m.role === 'assistant' ? { role: 'assistant', content: m.content, usage: m.usage ?? null } : { role: 'user', content: m.content })
  }
  return out
}
