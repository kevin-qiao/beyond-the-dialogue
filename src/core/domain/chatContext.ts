import type { Task, TaskPreprocess } from '../../shared/types'
import type { TaskCategory } from './categories'

// What a task-grounded chat session is told about its task.
//
// This used to be a chain of `kind === 'learning'` / `kind === 'jira'` ternaries
// in the transport. It has the same shape as the pre-process registry and for
// the same reason: a category that nobody added a branch for is not an error
// anybody sees — the session simply gets *less* grounding and answers from a
// thinner picture. When `meeting` was added, that is exactly what happened: a
// meeting's chat never received its own objective or focus prompt, and nothing
// failed or warned.
//
// So the registry is total over the categories that have a pre-process, and
// `test/chatContext.test.ts` asserts that. A missing entry for a category that
// can be chatted with is a test failure, not a quiet degradation.

const MAX_CONTENT = 60_000

export interface ChatContextInput {
  task: Pick<Task, 'title' | 'notes' | 'inputs'>
  preprocess: TaskPreprocess | null
  /** The user's working content (note, minutes), when they have written any. */
  workingContent: string | null
}

export interface ChatContextInstruction {
  /** The complete grounding for this category, in the order it is presented. */
  build: (input: ChatContextInput) => string[]
}

const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v : '')

/** Whitespace-only content is no content: it must not produce a labelled line. */
const has = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0

const cap = (s: string): string => s.slice(0, MAX_CONTENT)

const head = (task: ChatContextInput['task']): string[] => [
  `Task: ${task.title}`,
  task.notes ? `Description: ${task.notes}` : ''
]

/**
 * Every output the pre-process produced, in the order the task shows them.
 *
 * All three, deliberately. Grounding a chat in the summary alone made it the
 * one surface that saw a partial picture: the card showed the analysis, the
 * deposit archived it, and the chat that could act on it never received it.
 * An empty field contributes no line rather than an empty label, which is the
 * same rule the rest of this file follows.
 */
function preprocessLines(p: TaskPreprocess | null): string[] {
  if (!p) return []
  const suggestions = p.suggestions ?? []
  return [
    text(p.summary) ? `Pre-process summary: ${p.summary}` : '',
    text(p.analysis) ? `Pre-process analysis: ${p.analysis}` : '',
    suggestions.length > 0 ? `Pre-process suggestions:\n${suggestions.map((s) => `- ${s}`).join('\n')}` : ''
  ].filter(Boolean)
}

const learning: ChatContextInstruction = {
  build: ({ task, preprocess, workingContent }) =>
    [
      ...head(task),
      ...preprocessLines(preprocess),
      text(task.inputs.target) ? `Target: ${text(task.inputs.target)}` : '',
      text(task.inputs.purpose) ? `Prompt: ${text(task.inputs.purpose)}` : '',
      has(workingContent) ? `Current learning note:\n${cap(workingContent)}` : ''
    ].filter(Boolean)
}

const jira: ChatContextInstruction = {
  build: ({ task, preprocess }) =>
    [
      ...head(task),
      ...preprocessLines(preprocess),
      `Source kind: ${task.inputs.sourceKind === 'page' ? 'Confluence page' : 'JIRA issue'}`,
      text(task.inputs.sourceText) ? `Pasted source content:\n${cap(text(task.inputs.sourceText))}` : ''
    ].filter(Boolean)
}

const meeting: ChatContextInstruction = {
  build: ({ task, preprocess, workingContent }) =>
    [
      ...head(task),
      ...preprocessLines(preprocess),
      text(task.inputs.target) ? `Objective: ${text(task.inputs.target)}` : '',
      text(task.inputs.purpose) ? `Prompt: ${text(task.inputs.purpose)}` : '',
      has(workingContent) ? `Minutes so far:\n${cap(workingContent)}` : ''
    ].filter(Boolean)
}

/**
 * The categories whose tasks open a chat panel. `plain` is absent: its working
 * area has no chat, so there is no grounding to build.
 */
export const CHAT_CONTEXT_INSTRUCTIONS: Partial<Record<TaskCategory, ChatContextInstruction>> = {
  learning,
  jira,
  meeting
}

/**
 * The grounding for a task's chat, or undefined when its category has none.
 *
 * Undefined means "this category has no chat", not "we forgot this category" —
 * the latter is caught by the totality test rather than papered over here.
 */
export function buildChatContext(category: TaskCategory, input: ChatContextInput): string | undefined {
  const instruction = CHAT_CONTEXT_INSTRUCTIONS[category]
  if (!instruction) return undefined
  const lines = instruction.build(input)
  return lines.length > 0 ? lines.join('\n') : undefined
}
