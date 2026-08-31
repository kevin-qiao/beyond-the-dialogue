import * as path from 'node:path'
import type { JobContext } from '../job-queue'
import { getTask, getAnalysis, getNotes, loadSettings, updateIngest } from '../db'
import { createJobSession } from '../session-factory'
import { piAgentDir } from '../paths'
import { depositTask, resolveWikiPath, snapshotWikiFiles, diffTouchedFiles } from '../wiki'

const INGEST_SYSTEM_PROMPT = `You are the maintainer of a personal knowledge wiki. You will ingest a finished paper into the wiki by following the workflow in the CLAUDE.md schema file in your working directory.

Your job:
1. Read CLAUDE.md to learn the wiki conventions.
2. Read the raw deposit under the task's folder in raw/.
3. Write a source summary page under wiki/sources/.
4. Update index.md to include it.
5. Update related entity/concept pages where applicable.
6. Append an entry to log.md using the required convention.

You have read/write/edit/grep/find/ls tools only. Never use a shell. Work only within this wiki directory. Do not modify anything under raw/.`

// Ingestion agent: confined to the wiki dir, no shell, curated tools.
export async function runIngestJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('ingest job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')

  const settings = loadSettings(db)
  const wikiPath = resolveWikiPath(settings.wikiPath)

  ctx.setStep('Depositing', 'Copying note + summary into raw/')
  const deposit = depositTask(db, taskId)
  if (deposit.files.length === 0) throw new Error('nothing to ingest: task has no notes or analysis')
  // Record the deposit files in the ledger (activity view).
  updateIngest(db, job.id, { depositFiles: deposit.files })

  ctx.setStep('Snapshotting', 'Backing up wiki files before changes')
  const touched = snapshotWikiFiles(wikiPath, [])
  // Record the files we protected with .history snapshots.
  updateIngest(db, job.id, { touchedFiles: touched })

  if (!settings.apiKey || !settings.model) throw new Error('AI not configured: no API key')

  ctx.setStep('Ingesting', 'Agent is writing wiki pages')
  const session = await createJobSession({
    settings,
    cwd: wikiPath,
    systemPrompt: INGEST_SYSTEM_PROMPT,
    thinkingLevel: 'medium',
    tools: ['read', 'write', 'edit', 'grep', 'find', 'ls']
  })

  // User cancel (jobs:cancel) aborts the in-flight agent call.
  ctx.onCancel(() => {
    void session.abort().catch(() => undefined)
  })

  const note = getNotes(db, taskId)
  const analysis = getAnalysis(db, taskId)
  const prompt = `Ingest this finished paper into the wiki.

Paper task: ${task.title}
Raw deposit folder: ${path.join('raw', taskId)}/
Reading notes present: ${note && note.content.trim() ? 'yes' : 'no'}
Analysis present: ${analysis ? 'yes' : 'no'}

Follow the CLAUDE.md workflow. When done, list the files you created or modified.`

  session.subscribe((ev: any) => {
    if (ev.type === 'tool_execution_start') {
      ctx.setStep(`Wiki: ${ev.name ?? ''}`, ev.name === 'write' || ev.name === 'edit' ? 'writing pages' : 'reading')
    }
  })

  try {
    await session.prompt(prompt, { expandPromptTemplates: false })
    // Report the files the agent actually created/modified (diff vs snapshot).
    updateIngest(db, job.id, { touchedFiles: diffTouchedFiles(wikiPath) })
    ctx.setStep('Complete', 'Wiki ingestion complete')
  } finally {
    await session.abort().catch(() => undefined)
  }
}

export { depositTask }
