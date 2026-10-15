import type { DatabaseSync } from 'node:sqlite'
import type { ConversationStorePort, ConversationTaskMaterial } from '../../../core/ports/conversations'
import type { Conversation, ConversationMessage } from '../../../shared/types'
import {
  appendConversationMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getNotes,
  getTask,
  listConversations,
  listConversationMessages,
  listTypes
} from '../../db'
import { effectiveType } from '../../../core/domain/taskType'

// The ConversationStorePort over the v14 tables. Mechanical by design — it
// adds no rules (the service owns them) and, like the port it implements,
// exposes NO task mutation: the one task-facing method assembles the
// read-only grounding material and nothing else (FR-010, structural).

export function createSqliteConversationStore(db: DatabaseSync): ConversationStorePort {
  return {
    listForTask: (taskId: string): Conversation[] => listConversations(db, taskId),
    create: (taskId: string): Conversation => createConversation(db, taskId),
    get: (conversationId: string): Conversation | null => getConversation(db, conversationId),
    appendMessage: (conversationId: string, entry): ConversationMessage =>
      appendConversationMessage(db, conversationId, entry),
    messagesFor: (conversationId: string): ConversationMessage[] => listConversationMessages(db, conversationId),
    delete: (conversationId: string): void => deleteConversation(db, conversationId),

    taskMaterial(taskId: string): ConversationTaskMaterial | null {
      const task = getTask(db, taskId)
      if (!task || task.deletedAt) return null
      return {
        task,
        typeDef: effectiveType(listTypes(db), task),
        workingContent: getNotes(db, taskId)?.content ?? null
      }
    }
  }
}
