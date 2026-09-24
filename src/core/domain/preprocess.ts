import type { Task } from '../../shared/types'
import type { MessageKey } from '../i18n'
import type { TaskCategory } from './categories'

// Per-category pre-processing.
//
// The category's ONE remaining job besides choosing a working area is deciding
// which analysis the assistant performs (contracts/type-definition.md). That
// used to be a binary `kind === 'learning' ? learningPrompt : jiraPrompt`,
// which silently sent any new category down the jira path. It is now a
// registry: a category with no entry has no pre-process, and adding one is an
// entry rather than another branch.
//
// The OUTPUT CONTRACT is per-category for the same reason. It used to be one
// shared block, and it only ever fitted the category that happened not to
// override it: `jira` and `meeting` both patched the generic wording with a
// "For this category …" paragraph, while `learning` inherited a description of
// an analysis its own preamble never described ("the analysis described
// above"). Each declaration now states its own field descriptions, and
// `outputContract` is required, so there is no generic wording left to inherit
// by omission.
//
// The envelope is deliberately three fields. An earlier fourth
// (`generatedPrompt`) had no renderer consumer at all — it was stored, written
// into the deposit, and put in chat grounding, but never shown on the task, and
// the one thing it added to chat was covered by the summary and the user's own
// prompt input. The coach is no longer asked for a field nothing displays.
//
// What stays shared is the ENVELOPE — the three field names. They are rendered
// from one typed list, so a prompt cannot ask for a key the parser does not
// read, and a field added to `PreprocessOutput` without being listed is a
// compile error rather than a key the assistant is never asked for.

export interface PreprocessOutput {
  summary: string
  analysis: string
  suggestions: string[]
}

/**
 * The one list of output field names. `renderOutputContract` emits exactly
 * these, in this order.
 */
const OUTPUT_KEYS = [
  'summary',
  'analysis',
  'suggestions'
] as const satisfies readonly (keyof PreprocessOutput)[]

type OutputKey = (typeof OUTPUT_KEYS)[number]

// Compile error if a field of PreprocessOutput is missing from OUTPUT_KEYS.
type _AssertAllOutputKeysListed<T extends true> = T
type _OutputKeysAreExhaustive = _AssertAllOutputKeysListed<
  Exclude<keyof PreprocessOutput, OutputKey> extends never ? true : false
>

/**
 * The output fields that are plain strings. Listed separately because
 * `suggestions` is an array; a rename in `PreprocessOutput` breaks this list
 * rather than leaving `parsePreprocessOutput` reading a key that no longer
 * exists and quietly returning `''`.
 */
const STRING_KEYS = ['summary', 'analysis'] as const satisfies readonly OutputKey[]

/** One description per output field, in the words the assistant will read. */
type ContractFields = Record<keyof PreprocessOutput, string>

/**
 * The JSON envelope, rendered from `OUTPUT_KEYS` so the key names have exactly
 * one home. Each value is the description the category supplied — JSON-literal
 * text, quotes included, because it is echoed into the prompt verbatim.
 */
function renderOutputContract(fields: ContractFields): string {
  const body = OUTPUT_KEYS.map((key) => `  ${JSON.stringify(key)}: ${fields[key]}`).join(',\n')
  return `{\n${body}\n}`
}

/** The rules a category starts from, unless it declares its own. */
const SHARED_RULES = `Rules:
- Work ONLY from the user's own text and the task's declared inputs. Do not invent links or claim to have read attachments.
- Output ONLY the JSON object. No markdown fences, no commentary.`

function line(label: string, value: unknown): string {
  return typeof value === 'string' && value.trim() ? `${label}: ${value}` : ''
}

/** JIRA's two sub-shapes. Anything but 'page' is an issue. */
function isIssue(inputs: Record<string, unknown>): boolean {
  return inputs.sourceKind !== 'page'
}

export interface PreprocessPromptArgs {
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
}

/**
 * What a category declares. `toInstruction` turns one of these into the runtime
 * entry the job runs, composing the shared scaffolding around the parts that
 * actually differ between categories.
 */
interface PreprocessDeclaration {
  /** Progress label shown while the run is in flight. A key, because the job
   *  that emits it knows the language; this module does not. */
  step: MessageKey
  /** Who the assistant is, and the one JSON object it must produce. */
  role: (args: PreprocessPromptArgs) => string
  /** This category's description of each output field. */
  outputContract: (args: PreprocessPromptArgs) => ContractFields
  /** Extra prose between the contract and the rules — a format spec, say. */
  contractNotes?: (args: PreprocessPromptArgs) => string
  /** The rules block. Defaults to `SHARED_RULES`. */
  rules?: (args: PreprocessPromptArgs) => string
  /** Header of the trailing block. Defaults to `===TASK CONTEXT===`. */
  contextLabel?: string
  /** Whether the trailing blocks include the user's own prompt. Defaults true. */
  includeUserPrompt?: boolean
  buildContext: (task: Pick<Task, 'title' | 'notes'>, inputs: Record<string, unknown>) => string
}

export interface PreprocessInstruction {
  /** Progress label shown while the run is in flight. */
  step: MessageKey
  buildContext: PreprocessDeclaration['buildContext']
  buildPrompt: (args: PreprocessPromptArgs) => string
}

/**
 * The prompt every category shares, assembled around what it declares:
 * role → contract → notes → guidance → rules → the user's prompt → context.
 */
function composePrompt(decl: PreprocessDeclaration, args: PreprocessPromptArgs): string {
  const blocks: string[] = []

  let head = `${decl.role(args)}\n\n${renderOutputContract(decl.outputContract(args))}`
  if (decl.contractNotes) head += `\n${decl.contractNotes(args)}`
  blocks.push(head)

  const guidance = args.aiGuidance ? `Type-specific guidance: ${args.aiGuidance}\n` : ''
  blocks.push(`${guidance}${decl.rules ? decl.rules(args) : SHARED_RULES}`)

  if (decl.includeUserPrompt !== false) {
    blocks.push(`===USER PROMPT===\n${args.userPrompt || '(none)'}`)
  }
  blocks.push(`${decl.contextLabel ?? '===TASK CONTEXT==='}\n${args.context}`)

  return blocks.join('\n\n')
}

function toInstruction(decl: PreprocessDeclaration): PreprocessInstruction {
  return {
    step: decl.step,
    buildContext: decl.buildContext,
    buildPrompt: (args) => composePrompt(decl, args)
  }
}

// ---- the categories ----

const learning: PreprocessDeclaration = {
  step: 'preprocess.step.learning',
  role: () =>
    `You are a learning coach who is good at building study plans and agendas. A user wants to learn something and needs your help with concrete study suggestions: core concepts, a learning sequence, a study schedule, easily overlooked issues, and learning methods.

Read the user's intention from the information below. Topic and Description tell you what is being learned; Target tells you why, in the user's own words. Where you go beyond what the user actually wrote, say that you are inferring rather than stating it.

Produce exactly one JSON object:`,
  // The attachment is deliberately absent: a pre-process session runs with no
  // tools and the vault as its cwd, so the assistant cannot open the file. It
  // still reaches the wiki at Finish — the deposit carries it (see the ingest
  // job). Telling the model about a file it cannot read would invite it to
  // claim a read it never made, which SHARED_RULES forbids.
  outputContract: () => ({
    summary: '"the topic and its target in your own words — 1-2 sentences, at most 50 words"',
    analysis:
      '"your fuller read, at most 80 words: what the topic actually covers, what the user appears to be after, and what that implies for how they should study it"',
    suggestions:
      '["2 to 3 concrete study suggestions drawn from your analysis — sequence, schedule, easily overlooked issues, methods (max ~12 words each)"]'
  }),
  buildContext: (task, inputs) =>
    [`Topic: ${task.title}`, `Description: ${task.notes || '(none)'}`, line('Target', inputs.target)]
      .filter(Boolean)
      .join('\n')
}

const jira: PreprocessDeclaration = {
  step: 'preprocess.step.jira',
  role: ({ inputs }) =>
    `You are a work-assistance agent embedded in a to-do app. The user pasted content from ${isIssue(inputs) ? 'a JIRA issue' : 'a Confluence page'}. Analyze the pasted content below and produce exactly one JSON object:`,
  // Two sub-shapes with genuinely different deliverables, so the contract is
  // built rather than chosen: an issue wants a triage read, a page wants an
  // editorial one.
  outputContract: ({ inputs }) =>
    isIssue(inputs)
      ? {
          summary: '"a summary of the issue\'s status as understood from the pasted content"',
          analysis: '"one sentence naming the single next action that most advances this issue"',
          suggestions: '["2 to 3 next actions toward resolving the issue (max ~12 words each)"]'
        }
      : {
          summary: '"a summary of the page content together with an assessment of its quality"',
          analysis: '"one sentence naming what this page most needs before it can be relied on"',
          suggestions: '["2 to 3 improvements to the page (max ~12 words each)"]'
        },
  // This category writes its own rules rather than extending SHARED_RULES: the
  // no-access rule is TRUE for an ungranted type and false for a granted one,
  // and stating it unconditionally would tell a granted session to ignore a
  // source it can genuinely read (FR-021).
  rules: ({ granted }) => {
    const accessRule = granted
      ? `- You may have live access to the referenced system: when you do, prefer what you read from it over the pasted content, and say which you used.`
      : `- You have no access to the remote system — never claim to have fetched or updated anything.`
    return `Rules:
- Base everything on the pasted content and, where you have access, on the live source; where information is missing, say so.
${accessRule}
- Output ONLY the JSON object. No markdown fences, no commentary.`
  },
  contextLabel: '===PASTED CONTENT===',
  includeUserPrompt: false,
  buildContext: (task, inputs) =>
    [
      `Title: ${task.title}`,
      `Description/notes: ${task.notes || '(none)'}`,
      `Source kind: ${isIssue(inputs) ? 'JIRA issue' : 'Confluence page'}`,
      line('Source link (reference only)', inputs.sourceLink),
      line('What the user wants done', inputs.target),
      `--- pasted content ---\n${typeof inputs.sourceText === 'string' ? inputs.sourceText.slice(0, 200_000) : '(none)'}`
    ]
      .filter(Boolean)
      .join('\n')
}

const meeting: PreprocessDeclaration = {
  step: 'preprocess.step.meeting',
  role: () =>
    `You are a meeting preparation assistant embedded in a to-do app. From the meeting's own objective and description below, produce exactly one JSON object:`,
  outputContract: () => ({
    summary: '"the suggested agenda and core topics described below, formatted as exactly those two markdown sections"',
    analysis: '"one sentence naming what this meeting most needs to settle"',
    suggestions: '["2 to 3 things to prepare or bring to the meeting (max ~12 words each)"]'
  }),
  // The agenda's shape is a format spec rather than a field description, so it
  // stays a separate block: a multi-line spec does not belong inside the JSON
  // contract the assistant is echoing.
  contractNotes: () =>
    `For this category the "summary" MUST be formatted as exactly these two markdown sections:

## Suggested agenda
1. <a numbered running order with rough timings, derived only from what the user wrote>

## Core topics
- <the few things this meeting must actually settle, each on its own bullet>

Keep the agenda to the material the user supplied: a meeting about a beta launch has no budget item unless the user said so.`,
  buildContext: (task, inputs) =>
    [
      `Title: ${task.title}`,
      `Description/notes: ${task.notes || '(none)'}`,
      line('Objective', inputs.target),
      line('What the agenda should focus on', inputs.purpose),
      typeof inputs.filePath === 'string' && inputs.filePath ? `Attachment available: ${inputs.filePath}` : ''
    ]
      .filter(Boolean)
      .join('\n')
}

/**
 * The categories that have a pre-process. `plain` is absent, which is why it is
 * absent rather than mapped to a no-op.
 *
 * Built once at module load: `preprocessInstruction` returns these exact
 * objects, and callers compare them by identity.
 */
function buildRegistry(
  decls: Partial<Record<TaskCategory, PreprocessDeclaration>>
): Partial<Record<TaskCategory, PreprocessInstruction>> {
  const out: Partial<Record<TaskCategory, PreprocessInstruction>> = {}
  for (const [category, decl] of Object.entries(decls) as [TaskCategory, PreprocessDeclaration][]) {
    out[category] = toInstruction(decl)
  }
  return out
}

export const PREPROCESS_INSTRUCTIONS: Partial<Record<TaskCategory, PreprocessInstruction>> = buildRegistry({
  learning,
  jira,
  meeting
})

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
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  const strings = Object.fromEntries(
    STRING_KEYS.map((key) => [key, typeof parsed[key] === 'string' ? (parsed[key] as string) : ''])
  ) as Record<(typeof STRING_KEYS)[number], string>
  return {
    ...strings,
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
      : []
  }
}
