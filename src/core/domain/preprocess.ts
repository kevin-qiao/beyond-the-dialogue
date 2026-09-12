import type { Task } from '../../shared/types'
import type { TaskCategory } from './categories'

// Per-category pre-processing.
//
// The category's ONE remaining job besides choosing a working area is deciding
// which analysis the assistant performs (contracts/type-definition.md). That
// used to be a binary `kind === 'learning' ? learningPrompt : jiraPrompt`,
// which silently sent any new category down the jira path. It is now a
// registry: a category with no entry has no pre-process, and adding one is an
// entry rather than another branch.

export interface PreprocessOutput {
  generatedPrompt: string
  summary: string
  analysis: string
  suggestions: string[]
}

export interface PreprocessInstruction {
  /** Progress label shown while the run is in flight. */
  step: string
  buildContext: (task: Pick<Task, 'title' | 'notes'>, inputs: Record<string, unknown>) => string
  buildPrompt: (args: {
    context: string
    userPrompt: string
    aiGuidance: string
    inputs: Record<string, unknown>
    /**
     * Whether the type has been granted external reach. A confined pre-process
     * never has one, so this is false on every path that ships today; it exists
     * because the INSTRUCTION must not tell the assistant it has no access to a
     * system the session can actually reach (FR-021).
     */
    granted?: boolean
  }) => string
}

const OUTPUT_CONTRACT = `{
  "generatedPrompt": "a working prompt the user can start from — 1-3 sentences addressing them directly, or \\"\\" when the analysis does not need one",
  "summary": "the analysis described above, as markdown",
  "analysis": "one sentence guessing what the user most likely intends to accomplish",
  "suggestions": ["2 to 3 concrete actions (max ~12 words each)"]
}`

const SHARED_RULES = `Rules:
- Work ONLY from the user's own text and the task's declared inputs. Do not invent links or claim to have read attachments.
- Output ONLY the JSON object. No markdown fences, no commentary.`

function line(label: string, value: unknown): string {
  return typeof value === 'string' && value.trim() ? `${label}: ${value}` : ''
}

const learning: PreprocessInstruction = {
  step: 'Generating learning summary',
  buildContext: (task, inputs) =>
    [`Title: ${task.title}`, `Description/notes: ${task.notes || '(none)'}`, line('Target', inputs.target)]
      .filter(Boolean)
      .join('\n'),
  buildPrompt: ({ context, userPrompt, aiGuidance }) => `You are a learning coach embedded in a to-do app. A user is about to study a topic. From the user's prompt and the task context below produce exactly one JSON object:

${OUTPUT_CONTRACT}

${aiGuidance ? `Type-specific guidance: ${aiGuidance}\n` : ''}${SHARED_RULES}

===USER PROMPT===
${userPrompt || '(none)'}

===TASK CONTEXT===
${context}`
}

const jira: PreprocessInstruction = {
  step: 'Summarizing pasted content',
  buildContext: (task, inputs) => {
    const isIssue = inputs.sourceKind !== 'page'
    return [
      `Title: ${task.title}`,
      `Description/notes: ${task.notes || '(none)'}`,
      `Source kind: ${isIssue ? 'JIRA issue' : 'Confluence page'}`,
      line('Source link (reference only)', inputs.sourceLink),
      line('What the user wants done', inputs.target),
      `--- pasted content ---\n${typeof inputs.sourceText === 'string' ? inputs.sourceText.slice(0, 200_000) : '(none)'}`
    ]
      .filter(Boolean)
      .join('\n')
  },
  buildPrompt: ({ context, aiGuidance, inputs, granted }) => {
    const isIssue = inputs.sourceKind !== 'page'
    // The no-access rule is TRUE for an ungranted type and false for a granted
    // one. Stating it unconditionally would tell a granted session to ignore a
    // source it can genuinely read (FR-021).
    const accessRule = granted
      ? `- You may have live access to the referenced system: when you do, prefer what you read from it over the pasted content, and say which you used.`
      : `- You have no access to the remote system — never claim to have fetched or updated anything.`
    return `You are a work-assistance agent embedded in a to-do app. The user pasted content from ${isIssue ? 'a JIRA issue' : 'a Confluence page'}. Analyze the pasted content below and produce exactly one JSON object:

${OUTPUT_CONTRACT}
For this category, "summary" must be ${isIssue ? "a summary of the issue's status as understood from the pasted content" : 'a summary of the page content together with an assessment of its quality'}, and "suggestions" must be ${isIssue ? 'next actions toward resolving the issue' : 'improvements to the page'}.

${aiGuidance ? `Type-specific guidance: ${aiGuidance}\n` : ''}Rules:
- Base everything on the pasted content and, where you have access, on the live source; where information is missing, say so.
${accessRule}
- Output ONLY the JSON object. No markdown fences, no commentary.

===PASTED CONTENT===
${context}`
  }
}

const meeting: PreprocessInstruction = {
  step: 'Proposing an agenda',
  buildContext: (task, inputs) =>
    [
      `Title: ${task.title}`,
      `Description/notes: ${task.notes || '(none)'}`,
      line('Objective', inputs.target),
      line('What the agenda should focus on', inputs.purpose),
      typeof inputs.filePath === 'string' && inputs.filePath ? `Attachment available: ${inputs.filePath}` : ''
    ]
      .filter(Boolean)
      .join('\n'),
  buildPrompt: ({ context, userPrompt, aiGuidance }) => `You are a meeting preparation assistant embedded in a to-do app. From the meeting's own objective and description below, produce exactly one JSON object:

${OUTPUT_CONTRACT}
For this category the "summary" MUST be a suggested agenda and the core topics, formatted as exactly these two markdown sections:

## Suggested agenda
1. <a numbered running order with rough timings, derived only from what the user wrote>

## Core topics
- <the few things this meeting must actually settle, each on its own bullet>

Keep the agenda to the material the user supplied: a meeting about a beta launch has no budget item unless the user said so.

${aiGuidance ? `Type-specific guidance: ${aiGuidance}\n` : ''}${SHARED_RULES}

===USER PROMPT===
${userPrompt || '(none)'}

===TASK CONTEXT===
${context}`
}

/**
 * The categories that have a pre-process. `plain` has none, which is why it is
 * absent rather than mapped to a no-op.
 */
export const PREPROCESS_INSTRUCTIONS: Partial<Record<TaskCategory, PreprocessInstruction>> = {
  learning,
  jira,
  meeting
}

export function preprocessInstruction(category: TaskCategory): PreprocessInstruction | null {
  return PREPROCESS_INSTRUCTIONS[category] ?? null
}

export function hasPreprocess(category: TaskCategory): boolean {
  return preprocessInstruction(category) !== null
}

/** Parse the strict-JSON output every pre-process instruction must produce. */
export function parsePreprocessOutput(text: string): PreprocessOutput {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('pre-process agent returned no JSON object')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  return {
    generatedPrompt: typeof parsed.generatedPrompt === 'string' ? parsed.generatedPrompt : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
      : []
  }
}
