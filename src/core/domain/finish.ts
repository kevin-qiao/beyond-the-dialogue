import type { Destination, Task, TaskTypeDef } from '../../shared/types'
import type { ArtifactStorePort } from '../ports/artifactStore'
import type { AgentSessionPort } from '../ports/agent'
import type { ClockPort } from '../ports/clock'
import type { FinishBehaviour } from './categories'

// The four finish behaviours (contracts/finish-behaviours.md). Exactly four
// exist; adding a fifth is meant to be a deliberate act with a known shape
// rather than an edit to a conditional.
//
// Every behaviour shares the same invariants:
//   - a finish never fails solely because AI is unconfigured (FR-025)
//   - the user's written content stays retrievable even when an assistant step
//     fails (FR-011, FR-027)
//   - an existing artifact is never overwritten or relocated (FR-026)
//   - no assistant step inside a finish ever receives a plugin grant (FR-020)

export interface FinishDestinationRef {
  store: Destination['store']
  root: string
  subdir: string
  absRoot: string
  abs: string
  /** Artifact path relative to `absRoot` (the filename). */
  rel: string
  /** Artifact path relative to `root`, subdir included. */
  rootRel: string
}

export interface FinishContext {
  task: Task
  typeDef: TaskTypeDef
  /** null only for 'complete-only'. */
  destination: FinishDestinationRef | null
  /** The user's own content: their minutes, or their working note. */
  workingContent: string
  declaredInputs: Record<string, unknown>
  store: ArtifactStorePort
  session: AgentSessionPort
  clock: ClockPort
  signal: AbortSignal
  onStep?: (label: string, progress?: string) => void
  /**
   * Structural detail as the strategy produces it, so the activity record can
   * show what was preserved even when a later step fails. `onStep` carries the
   * human-readable progress; this carries the file lists.
   */
  onDetail?: (detail: { depositFiles?: string[]; protectedFiles?: string[] }) => void
  /** Pre-rendered AI pre-process summary, for the deposit-first safety net. */
  summary?: string
  attachmentPath?: string
  /**
   * The curated target the curating agent should write to, relative to the
   * destination root. Supplied by the caller because a wiki destination lets
   * the user override the note path per task; falls back to the destination's
   * own subdir + filename.
   */
  noteTargetRel?: string
}

export interface FinishResult {
  /** null when nothing was written. */
  artifactPath: string | null
  assistantStep: 'skipped' | 'succeeded' | 'failed'
  /** What the finish actually wrote or modified. */
  touchedFiles: string[]
  /** Why the assistant step failed, when it did. Surfaced to the user. */
  assistantError?: string
  /** Files preserved ahead of the operation (deposit-first). */
  depositFiles?: string[]
}

export type FinishStrategy = (ctx: FinishContext) => Promise<FinishResult>

function requireDestination(ctx: FinishContext): FinishDestinationRef {
  if (!ctx.destination) {
    throw new Error(`type "${ctx.typeDef.key}" declares a writing finish behaviour but no destination`)
  }
  return ctx.destination
}

// ---- the four behaviours ----

/**
 * Writes nothing. Marks the task complete and clears its alarm. `plain` and
 * `jira` today; a destination is a configuration error, refused at save time.
 */
export const completeOnly: FinishStrategy = async () => ({
  artifactPath: null,
  assistantStep: 'skipped',
  touchedFiles: []
})

/** Writes the user's working content to the destination unchanged. */
export const fileAsIs: FinishStrategy = async (ctx) => {
  const dest = requireDestination(ctx)
  const path = await ctx.store.writeArtifact(dest, ctx.workingContent)
  return { artifactPath: path, assistantStep: 'skipped', touchedFiles: [dest.rel] }
}

/**
 * The assistant rewrites the content; the result is then written.
 *
 * The bound matters more than the transformation (FR-009): polish may
 * restructure and tighten prose, but it must preserve every fact, decision and
 * action item the user recorded and must not introduce any it did not. Those
 * are enforced, not merely requested — see `verifyPolish`.
 *
 * Degradation: with no provider, or when the assistant step fails or violates
 * the bound, the user's content is filed unpolished and the failure is
 * reported. A finish never fails outright (FR-025, FR-011).
 */
export const polishThenFile: FinishStrategy = async (ctx) => {
  const dest = requireDestination(ctx)
  const content = truncateForAssistant(ctx.workingContent)

  let polished: string | null = null
  let assistantStep: FinishResult['assistantStep'] = 'skipped'
  let assistantError: string | undefined

  if (!ctx.session.isAvailable()) {
    assistantStep = 'failed'
    assistantError = 'no AI provider is configured — the minutes were filed as written'
    ctx.onStep?.('Filing unpolished', 'AI not configured')
  } else {
    try {
      ctx.onStep?.('Polishing', 'Re-organizing the minutes')
      const raw = await ctx.session.run({
        purpose: 'confined',
        cwd: dest.root,
        systemPrompt: POLISH_SYSTEM_PROMPT,
        prompt: buildPolishPrompt(ctx, content),
        tools: [],
        thinkingLevel: 'medium',
        signal: ctx.signal,
        onStep: ctx.onStep
      })
      const draft = parsePolishOutput(raw)
      verifyPolish(draft, ctx.workingContent)
      polished = renderPolished(draft)
      assistantStep = 'succeeded'
    } catch (e: any) {
      assistantStep = 'failed'
      assistantError = e?.message ?? String(e)
      ctx.onStep?.('Filing unpolished', assistantError)
    }
  }

  const body = polished ?? ctx.workingContent
  const path = await ctx.store.writeArtifact(dest, body)
  return {
    artifactPath: path,
    assistantStep,
    touchedFiles: [dest.rel],
    ...(assistantError ? { assistantError } : {})
  }
}

/**
 * The existing Learning flow, preserved exactly (FR-003):
 * deposit first, snapshot, confined agent authors the artifact, diff to report
 * what it touched. The deposit is the part that survives any later failure,
 * which is why it comes first.
 */
export const depositThenCurate: FinishStrategy = async (ctx) => {
  const dest = requireDestination(ctx)

  ctx.onStep?.('Depositing', 'Preserving the raw material')
  const deposit = await ctx.store.deposit(dest, {
    taskId: ctx.task.id,
    title: ctx.task.title,
    content: ctx.workingContent,
    summary: ctx.summary,
    attachmentPath: ctx.attachmentPath
  })
  // Reported as it happens: the deposit is the part that survives a later
  // failure, so the activity record must show it even if the rest never runs.
  ctx.onDetail?.({ depositFiles: deposit.files })
  if (deposit.files.length === 0) {
    throw new Error('nothing to ingest: task has no notes or AI summary')
  }

  ctx.onStep?.('Snapshotting', 'Backing up files before changes')
  const handle = await ctx.store.snapshot(dest)
  ctx.onDetail?.({ protectedFiles: handle.files })

  if (!ctx.session.isAvailable()) {
    throw new Error('AI not configured: no API key')
  }

  ctx.onStep?.('Curating', 'The assistant is writing the finished note')
  await ctx.session.run({
    purpose: 'confined',
    // Bound to the destination ROOT, not the artifact subdir: the curating
    // agent has to reach the schema file, the raw deposit, index.md and log.md.
    cwd: dest.root,
    systemPrompt: STORE_SCHEMA_PROMPT,
    prompt: buildCuratePrompt(ctx, deposit.files),
    tools: ['read', 'write', 'edit', 'grep', 'find', 'ls'],
    thinkingLevel: 'medium',
    signal: ctx.signal,
    onStep: ctx.onStep
  })

  const touchedFiles = await ctx.store.diff(handle)
  return {
    artifactPath: dest.abs,
    assistantStep: 'succeeded',
    touchedFiles,
    depositFiles: deposit.files
  }
}

export const FINISH_STRATEGIES: Record<FinishBehaviour, FinishStrategy> = {
  'complete-only': completeOnly,
  'file-as-is': fileAsIs,
  'polish-then-file': polishThenFile,
  'deposit-then-curate': depositThenCurate
}

// ---- polish: prompt, parsing, and the bound ----

const POLISH_SYSTEM_PROMPT = `You re-organize and tighten meeting minutes. You are a careful editor, not an author.

You will be given minutes a user wrote during or after a meeting. Return exactly one JSON object:

{
  "polished": "the re-organized minutes as markdown, WITHOUT an action-items section",
  "actionItems": ["every action item the user recorded, quoted in their own words"],
  "preservedFacts": ["every decision and factual point the user recorded"]
}

Absolute rules — these are correctness requirements, not style guidance:
- Preserve EVERY fact, decision and action item the user recorded. Drop nothing.
- Introduce NOTHING the user did not write. Do not add plausible-sounding decisions, names, dates, numbers, owners, or next steps.
- The action items must be quoted from the user's own text, not paraphrased into new commitments.
- Do not add an action-items section yourself — it is appended from your "actionItems" list.
- Output ONLY the JSON object. No markdown fences, no commentary.`

function buildPolishPrompt(ctx: FinishContext, content: string): string {
  const parts = [`Task: ${ctx.task.title}`]
  if (ctx.task.notes) parts.push(`Description: ${ctx.task.notes}`)
  const objective = ctx.declaredInputs.target
  if (typeof objective === 'string' && objective.trim()) parts.push(`Objective: ${objective}`)
  if (ctx.typeDef.aiGuidance) parts.push(`Type guidance: ${ctx.typeDef.aiGuidance}`)
  parts.push(`\n===MINUTES AS WRITTEN BY THE USER===\n${content || '(empty)'}`)
  return parts.join('\n')
}

/**
 * The same bound the pre-process path applies, for the same reason: minutes
 * larger than the model can process must degrade predictably rather than fail
 * (T034). Truncation is reported through `assistantError` when it bites.
 */
export const POLISH_INPUT_LIMIT = 200_000

function truncateForAssistant(content: string): string {
  if (content.length <= POLISH_INPUT_LIMIT) return content
  return `${content.slice(0, POLISH_INPUT_LIMIT)}\n\n[...truncated at ${POLISH_INPUT_LIMIT} characters]`
}

export interface PolishDraft {
  polished: string
  actionItems: string[]
  preservedFacts: string[]
}

/**
 * Raised when a polish draft would introduce content the user did not record.
 * A failure of the behaviour, not a transient error — the finish degrades to
 * filing the user's own words rather than filing something they never wrote.
 */
export class PolishBoundExceeded extends Error {
  constructor(readonly untraceable: string[]) {
    super(
      `polish would have introduced content the user did not record: ${untraceable.join('; ')} — the minutes were filed as written`
    )
    this.name = 'PolishBoundExceeded'
  }
}

export function parsePolishOutput(text: string): PolishDraft {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('polish agent returned no JSON object')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
  const polished = typeof parsed.polished === 'string' ? parsed.polished.trim() : ''
  if (!polished) throw new Error('polish agent returned no polished text')
  return { polished, actionItems: strings(parsed.actionItems), preservedFacts: strings(parsed.preservedFacts) }
}

/**
 * FR-009 / SC-011, made checkable.
 *
 * Every action item and every preserved fact the assistant reports must be
 * traceable to the user's own words. An item that shares no significant word
 * with the minutes is something the user did not record, so it is refused.
 *
 * The honest bound: this catches *asserted* content — action items and facts
 * the assistant declares. A fabrication buried in flowing prose that the
 * assistant does not declare is not machine-detectable from a rewrite, which
 * is why the prompt states the rule absolutely and the check covers the
 * declarations. It is a real check, not a complete one, and it is not
 * described as complete.
 */
export function verifyPolish(draft: PolishDraft, userContent: string): void {
  const source = normalizeForMatch(userContent)
  const untraceable = [...draft.actionItems, ...draft.preservedFacts].filter((item) => !traceable(item, source))
  if (untraceable.length > 0) throw new PolishBoundExceeded(untraceable)
}

function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/**
 * True when every significant word of `item` appears in `source`. Light
 * paraphrase is therefore tolerated ("Send the deck" vs "send deck"), while an
 * invented commitment shares no vocabulary and is refused.
 */
function traceable(item: string, source: string): boolean {
  const words = item
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 3)
  if (words.length === 0) return true
  return words.every((w) => source.includes(` ${w} `) || source.includes(`${w} `))
}

/**
 * The finished document: the polished body, then the recorded action items as
 * a distinct section (FR-009). Appending it here rather than trusting the
 * model to produce one makes the section structural.
 */
export function renderPolished(draft: PolishDraft): string {
  if (draft.actionItems.length === 0) return draft.polished
  const bullets = draft.actionItems.map((a) => `- ${a.trim()}`).join('\n')
  return `${draft.polished}\n\n## Action items\n\n${bullets}\n`
}

export const STORE_SCHEMA_PROMPT = `You are the maintainer of a personal knowledge wiki. You will ingest a finished learning note into the wiki by following the workflow in the CLAUDE.md schema file in your working directory.

Your job:
1. Read CLAUDE.md to learn the wiki conventions.
2. Read the raw deposit under the task's folder in raw/.
3. Write (or update) the curated learning note at the learning-note path given in the request.
4. Update or create related entity/concept pages under wiki/ where applicable.
5. Update index.md to include the new/updated pages.
6. Append an entry to log.md using the required convention.

You have read/write/edit/grep/find/ls tools only. Never use a shell. Work only within this wiki directory. Do not modify anything under raw/.`

function buildCuratePrompt(ctx: FinishContext, depositFiles: string[]): string {
  const noteTarget = ctx.noteTargetRel ?? (ctx.destination ? ctx.destination.rootRel : '')
  return `Ingest this finished learning note into the wiki.

Task: ${ctx.task.title}
Type: ${ctx.typeDef.label}
Raw deposit folder: raw/${ctx.task.id}/
Learning-note path (curated note target, relative to the wiki): ${noteTarget || 'learning-notes/'}
Working note present: ${depositFiles.some((f) => f.endsWith('.md') && f !== 'ai-summary.md') ? 'yes' : 'no'}
AI summary present: ${depositFiles.includes('ai-summary.md') ? 'yes' : 'no'}

Follow the CLAUDE.md workflow. When done, list the files you created or modified.`
}
