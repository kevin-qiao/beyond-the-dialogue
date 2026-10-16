import type { ChatMessage, Conversation, ConversationMessage, Task, TaskTypeDef } from '../../shared/types'

// ConversationStorePort — the storage seam for task-owned conversations
// (feature 002, FR-008–FR-011, research D5).
//
// The structural guarantee lives in what is ABSENT: this port exposes no task
// mutation of any kind. A conversation can never act on the board (FR-010)
// because the service that holds this port has no way to change a task —
// "the handler enforces it structurally: the conversation service receives no
// task port" (data-model). The one task-facing member is READ-ONLY grounding
// material, assembled by the adapter.

/** The task picture a grounded conversation is built from — read-only. */
export interface ConversationTaskMaterial {
  task: Pick<Task, 'id' | 'title' | 'background' | 'target' | 'notes' | 'inputs' | 'type' | 'customTypeKey'>
  /** The Type whose declarations govern the task, when one resolves. */
  typeDef: TaskTypeDef | null
  /** The working-area content (the task note), when the user has written any. */
  workingContent: string | null
}

export interface AppendMessageInput {
  role: 'user' | 'assistant'
  /** Must not be empty (data-model rule); the service validates before it arrives. */
  content: string
  /** The chatMessages rule: an assistant message stores its usage metadata —
   *  without it the SDK's context estimator throws inside the provider call. */
  usage?: Record<string, unknown> | null
}

export interface ConversationStorePort {
  /** The task's conversations, newest first, with message counts (summaries). */
  listForTask(taskId: string): Conversation[]
  /** Start a fresh conversation; earlier ones remain (US2-AC4). */
  create(taskId: string): Conversation
  get(conversationId: string): Conversation | null
  /** Append in insertion order — the order the storage assigns, never memory. */
  appendMessage(conversationId: string, entry: AppendMessageInput): ConversationMessage
  messagesFor(conversationId: string): ConversationMessage[]
  delete(conversationId: string): void
  /** READ-ONLY task material for grounding assembly (FR-011). */
  taskMaterial(taskId: string): ConversationTaskMaterial | null
}

/**
 * The per-turn model call (research D5): ONE short-lived run per send, built
 * from the stored history plus the grounding, streaming deltas as they
 * arrive. Nothing is retained between turns — there is no open session to
 * leak, which is the resource half of D5's rationale. (The standing
 * dispose rule belongs to agent sessions with extensions; a conversation
 * turn resolves NO_GRANT and constructs none — D9.)
 */
export interface ConversationTurnPort {
  /** Why a turn cannot run right now, or that it can. */
  availability(): 'ready' | 'off' | 'not-configured'
  /**
   * Run one turn over the shaped history and return the assistant's text
   * with its usage metadata. Rejects on provider failure; a failed send keeps
   * the stored history intact (the caller stores nothing for the failure).
   */
  run(args: { history: ChatMessage[]; onDelta: (delta: string) => void }): Promise<{
    text: string
    usage?: Record<string, unknown> | null
  }>
}
