import type { JobContext } from './job-queue'
import { getTask, updateTask, savePreprocess, addSuggestion, clearSuggestions, loadSettings } from './db'
import { createJobSession } from './ai/session-factory'
import { effectiveTypeDef, preprocessInputHash } from './types'
import { vaultDir } from './paths'
import type { TaskKind } from '../shared/types'

// Pre-process job engine (design D3): one job per task, dispatched to the
// task's effective kind. Outputs are strict JSON from one agent turn — a
// working prompt (learning), a summary, and 2-3 activity suggestions that
// also land in the suggestions table as dismissible chips.

interface PreprocessOutput {
  generatedPrompt: string
  summary: string
  suggestions: string[]
}

function learningPrompt(context: string, aiGuidance: string): string {
  return `You are a learning coach embedded in a to-do app. A user is about to study a topic. From the task context below produce exactly one JSON object:

{
  "generatedPrompt": "a working prompt the user can start from — 1-3 sentences addressing them directly ('You are helping me learn ...')",
  "summary": "a concise paragraph on what this learning task is about and why it matters",
  "suggestions": ["2 to 3 concrete activities for tackling it (max ~12 words each)"]
}

${aiGuidance ? `Type-specific guidance: ${aiGuidance}\n` : ''}
Rules:
- Work ONLY from the task's own text (title, notes, target, purpose). Do not invent links or claim to have read attachments.
- Output ONLY the JSON object. No markdown fences, no commentary.

===TASK CONTEXT===
${context}`
}

function jiraPrompt(sourceKind: string, context: string, aiGuidance: string): string {
  const isIssue = sourceKind !== 'page'
  return `You are a work-assistance agent embedded in a to-do app. The user pasted content from ${isIssue ? 'a JIRA issue' : 'a Confluence page'}. Analyze the pasted content below and produce exactly one JSON object:

{
  "generatedPrompt": "",
  "summary": "${isIssue ? "a summary of the issue's status as understood from the pasted content" : 'a summary of the page content together with an assessment of its quality'}",
  "suggestions": ["2 to 3 concrete ${isIssue ? 'next actions toward resolving the issue' : 'improvements to the page'}"]
}

${aiGuidance ? `Type-specific guidance: ${aiGuidance}\n` : ''}
Rules:
- Base everything strictly on the pasted content; where information is missing, say so.
- You have no access to the remote system — never claim to have fetched or updated anything.
- Output ONLY the JSON object. No markdown fences, no commentary.

===PASTED CONTENT===
${context}`
}

function buildContext(task: { title: string; notes: string }, inputs: Record<string, unknown>, kind: TaskKind): string {
  const lines = [`Title: ${task.title}`, `Description/notes: ${task.notes || '(none)'}`]
  if (kind === 'learning') {
    if (inputs.target) lines.push(`Target: ${inputs.target}`)
    if (inputs.purpose) lines.push(`Purpose: ${inputs.purpose}`)
    if (inputs.link) lines.push(`Link (context only): ${inputs.link}`)
  } else if (kind === 'jira') {
    lines.push(`Source kind: ${inputs.sourceKind === 'page' ? 'Confluence page' : 'JIRA issue'}`)
    if (inputs.sourceLink) lines.push(`Source link (reference only): ${inputs.sourceLink}`)
    if (inputs.target) lines.push(`What the user wants done: ${inputs.target}`)
    lines.push(`--- pasted content ---\n${typeof inputs.sourceText === 'string' ? inputs.sourceText.slice(0, 200_000) : '(none)'}`)
  }
  return lines.join('\n')
}

function parseOutput(text: string): PreprocessOutput {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('pre-process agent returned no JSON object')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  return {
    generatedPrompt: typeof parsed.generatedPrompt === 'string' ? parsed.generatedPrompt : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: unknown): s is string => typeof s === 'string' && s.trim()).slice(0, 3) : []
  }
}

function extractAssistantText(msg: any): string {
  if (!msg) return ''
  const content = msg.content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
  }
  return typeof content === 'string' ? content : ''
}

export async function runPreprocessJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('preprocess job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')
  const def = effectiveTypeDef(db, task)
  const kind = def?.kind ?? 'plain'
  if (kind === 'plain') return // no-op guard; plain tasks never enqueue preprocess

  const settings = loadSettings(db)
  if (!settings.apiKey || !settings.model) {
    // Fail fast when no key is configured (task ops unaffected).
    updateTask(db, taskId, { preprocessStatus: 'failed', preprocessError: 'AI not configured: no API key' })
    throw new Error('AI not configured: no API key')
  }

  const inputsHash = preprocessInputHash(task, def)
  ctx.setStep('Pre-processing', kind === 'learning' ? 'Generating learning summary' : 'Summarizing pasted content')

  const prompt =
    kind === 'learning'
      ? learningPrompt(buildContext(task, task.inputs, kind), def?.aiGuidance ?? '')
      : jiraPrompt(typeof task.inputs.sourceKind === 'string' ? task.inputs.sourceKind : 'issue', buildContext(task, task.inputs, kind), def?.aiGuidance ?? '')

  const session = await createJobSession({
    settings,
    cwd: vaultDir(),
    systemPrompt: `You produce structured JSON analysis for work-board tasks. Follow the output contract exactly.`,
    thinkingLevel: 'medium',
    tools: [],
    noContextFiles: true
  })

  // User cancel (jobs:cancel) aborts the in-flight agent call.
  ctx.onCancel(() => {
    void session.abort().catch(() => undefined)
  })

  try {
    await session.prompt(prompt, { expandPromptTemplates: false })
    const last = [...session.messages].reverse().find((m: any) => m.role === 'assistant' && m.content?.length)
    const text = extractAssistantText(last)
    if (!text) throw new Error('pre-process agent produced no output')
    const out = parseOutput(text)

    savePreprocess(db, {
      taskId,
      kind,
      summary: out.summary,
      suggestions: out.suggestions,
      generatedPrompt: out.generatedPrompt,
      status: 'ready',
      inputsHash
    })
    // Activity suggestions land as dismissible chips (existing UI path).
    clearSuggestions(db, taskId)
    for (const s of out.suggestions) addSuggestion(db, taskId, s)
    updateTask(db, taskId, { preprocessStatus: 'ready', preprocessError: null })
    ctx.setStep('Complete', 'Pre-process complete')
  } catch (e: any) {
    // Do not mark the task failed here: transient errors are re-queued by the
    // job queue (status stays 'queued'), and the terminal 'failed' marker is
    // written by the queue's failed event (index.ts wireJobEvents).
    throw e instanceof Error ? e : new Error(String(e?.message ?? e))
  } finally {
    await session.abort().catch(() => undefined)
  }
}
