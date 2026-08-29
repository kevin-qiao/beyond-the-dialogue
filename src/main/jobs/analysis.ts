import type { DatabaseSync } from 'node:sqlite'
import type { JobContext } from '../job-queue'
import { getTask, updateTask, saveAnalysis, getAnalysis, loadSettings } from '../db'
import type { ReadingSuggestion } from '../../shared/types'
import { extractTextFromPdf, fetchPdf } from '../paper/pdf'
import { resolvePaper } from '../paper/resolve'
import { pdfPathFor, jobWorkspaceFor } from '../vault'
import { createJobSession } from '../session-factory'
import { Type } from 'typebox'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

const SYSTEM_PROMPT = `You are a meticulous academic reading assistant. You analyze a research paper and produce a structured summary plus reading suggestions.

The text of the paper (or its abstract, if full text was unavailable) is provided below the marker ===PAPER TEXT===. You must produce output in exactly this JSON shape and nothing else:

{
  "tldr": "one sentence summary",
  "contributions": ["3 to 6 concise contribution bullets"],
  "method": "2-4 sentence description of the method",
  "results": "2-4 sentence description of the key results",
  "prerequisites": ["2 to 4 concepts a reader should know first"],
  "suggestions": [
    { "kind": "effort", "title": "Estimated effort", "body": "..." },
    { "kind": "order", "title": "Suggested reading order", "body": "..." },
    { "kind": "question", "title": "Questions to consider", "body": "..." }
  ]
}

Rules:
- Be specific and cite concrete numbers or claims from the paper where possible.
- If only an abstract is available, still produce all fields but keep them concise and say the analysis is abstract-based where relevant.
- Output ONLY the JSON object. No markdown fences, no commentary.`

interface AnalysisAgentOutput {
  tldr: string
  contributions: string[]
  method: string
  results: string
  prerequisites: string[]
  suggestions: ReadingSuggestion[]
}

function parseAgentOutput(text: string): AnalysisAgentOutput {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('analysis agent returned no JSON object')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  return {
    tldr: typeof parsed.tldr === 'string' ? parsed.tldr : '',
    contributions: Array.isArray(parsed.contributions) ? parsed.contributions.filter((c: unknown) => typeof c === 'string') : [],
    method: typeof parsed.method === 'string' ? parsed.method : '',
    results: typeof parsed.results === 'string' ? parsed.results : '',
    prerequisites: Array.isArray(parsed.prerequisites) ? parsed.prerequisites.filter((c: unknown) => typeof c === 'string') : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter((s: any) => s && typeof s === 'object' && typeof s.body === 'string')
          .map((s: any, i: number) => ({
            id: randomUUID(),
            kind: ['effort', 'order', 'question'].includes(s.kind) ? s.kind : 'question',
            title: typeof s.title === 'string' ? s.title : '',
            body: s.body
          }))
      : []
  }
}

export async function runAnalysisJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('analysis job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')
  if (!task.link) throw new Error('task has no link')

  // --- Resolution step ---
  ctx.setStep('Resolving link', 'Resolving paper metadata')
  const resolved = await resolvePaper(task.link)
  if ('kind' in resolved) {
    updateTask(db, taskId, { analysisStatus: 'failed', analysisError: resolved.message })
    throw new Error(`link resolution failed: ${resolved.message}`)
  }
  ctx.setStep('Resolving link', `Found "${resolved.title}"`)

  // Title/link mismatch safeguard: record the resolved title; a mismatch
  // warning is surfaced to the user who can confirm/correct/attach before
  // the final analysis is stored.
  const paperTitle = task.paperTitle ?? task.title
  const mismatch = titleMismatch(paperTitle, resolved.title)

  // --- PDF / text extraction ---
  let paperText = resolved.abstract
  let level = resolved.level
  let scanned = false
  let pdfFetched = false

  const pdfTarget = pdfPathFor(taskId)
  if (task.pdfPath && fs.existsSync(task.pdfPath)) {
    ctx.setStep('Extracting text', 'Extracting text from attached PDF')
    const ext = await extractTextFromPdf(task.pdfPath)
    if (ext.text && !ext.scanned) {
      paperText = ext.text
      level = 'full'
      scanned = false
    } else {
      ctx.setStep('Extracting text', 'Attached PDF has no extractable text')
    }
  } else if (resolved.pdfUrl) {
    ctx.setStep('Fetching PDF', 'Downloading open-access PDF')
    try {
      await fetchPdf(resolved.pdfUrl, pdfTarget)
      pdfFetched = true
      const ext = await extractTextFromPdf(pdfTarget)
      if (ext.text && !ext.scanned) {
        paperText = ext.text
        level = 'full'
        scanned = false
      } else {
        ctx.setStep('Extracting text', 'Scanned PDF detected, using abstract only')
        scanned = true
        level = 'abstract'
      }
    } catch (e: any) {
      ctx.setStep('Fetching PDF', 'PDF unavailable, using abstract only')
      level = 'abstract'
    }
  }

  if (pdfFetched) updateTask(db, taskId, { pdfPath: pdfTarget })

  // Record metadata on the task before agent runs.
  updateTask(db, taskId, {
    paperTitle: resolved.title,
    analysisLevel: level,
    analysisStatus: 'running',
    mismatchState: mismatch ? 'warning' : task.mismatchState
  })

  // If mismatch is pending and not confirmed, we still run the analysis but
  // the user confirms before relying on the results (panel shows warning).
  const result = await runAnalysisAgent(ctx, paperText, resolved.title, level)

  saveAnalysis(db, {
    taskId,
    level,
    status: 'ready',
    tldr: result.tldr,
    contributions: result.contributions,
    method: result.method,
    results: result.results,
    prerequisites: result.prerequisites,
    suggestions: result.suggestions
  })
  updateTask(db, taskId, {
    analysisStatus: level === 'abstract' ? 'abstract_only' : 'ready',
    analysisError: null
  })
  ctx.setStep('Complete', 'Analysis complete')
}

function titleMismatch(provided: string, resolved: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const a = norm(provided)
  const b = norm(resolved)
  if (!a || !b) return false
  // Jaccard-ish overlap on word sets
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 2))
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return false
  let inter = 0
  for (const w of wordsA) if (wordsB.has(w)) inter++
  const overlap = inter / Math.min(wordsA.size, wordsB.size)
  return overlap < 0.3
}

async function runAnalysisAgent(
  ctx: JobContext,
  paperText: string,
  title: string,
  level: string
): Promise<AnalysisAgentOutput> {
  const { db, job } = ctx
  const settings = loadSettingsFor(db)

  const taskId = job.taskId ?? ''
  const workspace = jobWorkspaceFor(taskId)
  const tools = [fetchUrlTool(), extractPdfTool(taskId, level)]

  const session = await createJobSession({
    settings,
    cwd: workspace,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: 'medium',
    tools: tools.map((t) => t.name),
    customTools: tools,
    noContextFiles: true
  })

  const prompt = `Analyze the paper "${title}". Analysis level available: ${level.toUpperCase()} (${level === 'full' ? 'full text' : 'abstract only'}).

===PAPER TEXT===
${paperText.slice(0, 800_000)}`

  session.subscribe((ev: any) => {
    if (ev.type === 'tool_execution_start') {
      ctx.setStep(`Running tool: ${ev.name ?? ''}`, undefined)
    } else if (ev.type === 'message_update' || ev.type === 'delta') {
      ctx.setStep('Analyzing paper', 'Agent is reasoning')
    }
  })

  try {
    await session.prompt(prompt, { expandPromptTemplates: false })
    const messages = session.messages
    const last = [...messages].reverse().find((m: any) => m.role === 'assistant' && m.content?.length)
    const text = extractAssistantText(last)
    if (!text) throw new Error('analysis agent produced no output')
    return parseAgentOutput(text)
  } finally {
    await session.abort().catch(() => undefined)
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

function loadSettingsFor(db: DatabaseSync) {
  return loadSettings(db)
}

// ---- Custom agent tools ----

const fetchUrlTool = () => ({
  name: 'fetch_url',
  label: 'Fetch URL',
  description: 'Fetch the text content of a URL and return it. Use for checking an external page.',
  parameters: Type.Object({
    url: Type.String({ description: 'The URL to fetch' })
  }),
  async execute(_toolCallId: string, params: any) {
    try {
      const res = await fetch(params.url, { headers: { 'User-Agent': 'WorkBoard/0.1' } })
      if (!res.ok) return { content: [{ type: 'text', text: `HTTP ${res.status}` }], details: {} }
      const text = await res.text()
      return { content: [{ type: 'text', text: text.slice(0, 20_000) }], details: {} }
    } catch (e: any) {
      return { content: [{ type: 'text', text: `error: ${e?.message ?? e}` }], details: {} }
    }
  }
})

const extractPdfTool = (taskId: string, level: string) => ({
  name: 'extract_pdf_text',
  label: 'Extract PDF text',
  description:
    "Extract the full text of the current task's paper PDF. Use when you need the full text that was not included inline.",
  parameters: Type.Object({}),
  async execute() {
    if (level !== 'full') {
      return {
        content: [{ type: 'text', text: 'No full-text PDF is available for this paper; analysis is abstract-only.' }],
        details: {}
      }
    }
    const pdfPath = pdfPathFor(taskId)
    if (!fs.existsSync(pdfPath)) return { content: [{ type: 'text', text: 'PDF not downloaded yet.' }], details: {} }
    const ext = await extractTextFromPdf(pdfPath)
    if (ext.scanned) return { content: [{ type: 'text', text: 'PDF is scanned; no extractable text.' }], details: {} }
    return { content: [{ type: 'text', text: ext.text.slice(0, 300_000) }], details: {} }
  }
})
