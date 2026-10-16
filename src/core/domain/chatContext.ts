import type { Task, TaskTypeDef } from '../../shared/types'
import type { Family } from './family'

// What a task-grounded conversation is told about its task (research D10).
//
// This used to be a per-category registry with an entry for every category
// that had a pre-process — and `plain` was ABSENT, which was fine while only
// pre-processed kinds could chat. Feature 002 attaches a conversation to
// EVERY task (FR-008), so the family-less case is a first-class entry, not an
// absence. The lesson from 001 stands: the added `meeting` category silently
// received less grounding because a ternary did not know it, and nothing
// failed. The registry is total over the cases that exist, and
// `test/chatContext.test.ts` asserts that totality — a case the registry does
// not cover fails the test rather than degrading quietly.
//
// The grounding is built from DECLARATIONS, never from a type key (Principle
// I): title, background, target, the Type's declared inputs, and the
// working-area note when the task has one. The egress rule rides along
// (FR-011): the session sees only THIS task's material, because this block is
// the whole task picture the context construction receives.

const MAX_CONTENT = 60_000

export interface ChatContextInput {
  task: Pick<Task, 'title' | 'background' | 'target' | 'notes' | 'inputs'>
  /** The Type whose declarations govern this task, when one resolves. */
  typeDef: TaskTypeDef | null | undefined
  /** The working-area content (the task note), when the user has written any. */
  workingContent: string | null
}

export interface ChatContextInstruction {
  /** The complete grounding for this case, in the order it is presented. */
  build: (input: ChatContextInput) => string[]
}

/** Whitespace-only content is no content: it must not produce a labelled line. */
const has = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0

const cap = (s: string): string => s.slice(0, MAX_CONTENT)

/** The lines every case shares: the task's own head material. */
function head({ task, typeDef }: ChatContextInput): string[] {
  const lines = [`Task: ${task.title}`]
  if (has(task.background)) lines.push(`Background: ${cap(task.background)}`)
  if (has(task.target)) lines.push(`Target: ${cap(task.target)}`)
  if (has(task.notes)) lines.push(`Description: ${cap(task.notes)}`)
  // Declared inputs only (FR-011's egress rule at the grounding level): an
  // input the Type does not declare is not this task's declared material.
  for (const field of typeDef?.inputSchema ?? []) {
    const value = task.inputs?.[field.key]
    if (typeof value === 'string' && value.trim()) lines.push(`${field.label || field.key}: ${cap(value)}`)
  }
  return lines
}

/**
 * A document-family task: its working-area note is the DRAFT — the user's own
 * work in progress (research D3) — and is presented as such.
 */
const documentCase: ChatContextInstruction = {
  build: (input) => [
    ...head(input),
    has(input.workingContent) ? `Working-area draft:\n${cap(input.workingContent)}` : ''
  ].filter(Boolean)
}

/**
 * A family-less task (`plain` and its user-defined equivalents): no assistance
 * is declared, but the conversation still grounds in everything the task
 * actually holds (US2-AC5). The note is ordinary additional information here,
 * not a draft.
 *
 * Not-yet-live families (working-system, coding) receive this treatment in
 * dispatch terms until their own features land (T033's honest affordance).
 */
const familyLessCase: ChatContextInstruction = {
  build: (input) => [
    ...head(input),
    has(input.workingContent) ? `Notes:\n${cap(input.workingContent)}` : ''
  ].filter(Boolean)
}

/** The cases the registry covers. Total, and pinned by the totality test. */
export const CHAT_GROUNDING_CASES = ['document', 'family-less'] as const
export type ChatGroundingCase = (typeof CHAT_GROUNDING_CASES)[number]

export const CHAT_CONTEXT_INSTRUCTIONS: Record<ChatGroundingCase, ChatContextInstruction> = {
  document: documentCase,
  'family-less': familyLessCase
}

/**
 * Which grounding case a task's family selects. Total over every family value
 * including null: a family this feature has not lit up yet gets the
 * family-less treatment rather than falling out of the registry.
 */
export function chatCaseFor(family: Family | null | undefined): ChatGroundingCase {
  return family === 'document' ? 'document' : 'family-less'
}

/**
 * The grounding block for a task's conversation. Every task has one (FR-008):
 * this always returns at least the task title line.
 */
export function buildChatContext(typeDef: TaskTypeDef | null | undefined, input: ChatContextInput): string {
  const instruction = CHAT_CONTEXT_INSTRUCTIONS[chatCaseFor(typeDef?.family ?? null)]
  const lines = instruction.build({ ...input, typeDef })
  return lines.join('\n')
}
