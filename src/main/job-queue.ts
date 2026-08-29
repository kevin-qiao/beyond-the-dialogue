import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { JobKind, JobRecord, JobState } from '../shared/types'
import { createJob, createIngest, getIngest, getJob, listActiveIngest, listRunningJobs, updateIngest, updateJob, type IngestPatch } from './db'
import type { IngestRecord } from '../shared/types'

export interface JobContext {
  db: DatabaseSync
  job: JobRecord
  setStep: (label: string, progress?: string) => void
  isCancelled: () => boolean
}

export type JobHandler = (ctx: JobContext) => Promise<void>

const RETRYABLE = ['rate_limit', 'overloaded', 'insufficient_quota', 'timeout', 'connection']

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return RETRYABLE.some((k) => msg.toLowerCase().includes(k))
}

export interface IngestStartSignal {
  tryStart: (taskId: string) => boolean
}

export class JobQueue extends EventEmitter {
  private handlers = new Map<JobKind, JobHandler>()
  private running = 0
  private maxConcurrent: number
  private queue: string[] = []
  private processing = false
  private db: DatabaseSync
  private ingestActive = new Set<string>()

  constructor(db: DatabaseSync, maxConcurrent = 2) {
    super()
    this.db = db
    this.maxConcurrent = maxConcurrent
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler)
  }

  enqueue(kind: JobKind, taskId: string | null): JobRecord {
    const job = createJob(this.db, kind, taskId)
    this.queue.push(job.id)
    this.emit('enqueued', job)
    this.pump()
    return job
  }

  enqueueIngest(taskId: string, taskTitle: string, depositFiles: string[]): IngestRecord {
    const rec = createIngest(this.db, taskId, taskTitle, depositFiles)
    this.ingestActive.add(taskId)
    this.emit('ingest-enqueued', rec)
    void this.runIngest(rec.id)
    return rec
  }

  retryIngest(ingestId: string): void {
    updateIngestState(this.db, ingestId, { state: 'queued', error: null })
    void this.runIngest(ingestId)
  }

  private async runIngest(ingestId: string): Promise<void> {
    const rec = ingestById(this.db, ingestId)
    if (!rec) return
    const handler = this.handlers.get('ingest')
    if (!handler) return
    updateIngestState(this.db, ingestId, { state: 'running', startedAt: new Date().toISOString(), attempts: rec.attempts + 1 })
    const job: JobRecord = {
      id: ingestId,
      kind: 'ingest',
      taskId: rec.taskId,
      state: 'running',
      stepLabel: null,
      progress: null,
      error: null,
      attempts: rec.attempts + 1,
      createdAt: rec.createdAt,
      startedAt: new Date().toISOString(),
      finishedAt: null
    }
    const ctx: JobContext = {
      db: this.db,
      job,
      setStep: (label, progress) => {
        updateIngestState(this.db, ingestId, { state: 'running' })
        this.emit('ingest-progress', { ingestId, taskId: rec.taskId, stepLabel: label, progress: progress ?? null })
      },
      isCancelled: () => false
    }
    try {
      await handler(ctx)
      updateIngestState(this.db, ingestId, { state: 'done', finishedAt: new Date().toISOString() })
      this.emit('ingest-done', ingestById(this.db, ingestId))
    } catch (e: any) {
      updateIngestState(this.db, ingestId, {
        state: 'failed',
        error: e?.message ?? String(e),
        finishedAt: new Date().toISOString()
      })
      this.emit('ingest-failed', ingestById(this.db, ingestId))
    } finally {
      this.ingestActive.delete(rec.taskId)
    }
  }

  retryJob(jobId: string): void {
    const job = getJob(this.db, jobId)
    if (!job) return
    if (job.state !== 'failed') return
    updateJob(this.db, jobId, { state: 'queued', error: null })
    this.queue.push(jobId)
    this.emit('retried', job)
    this.pump()
  }

  private pump(): void {
    if (this.processing) return
    this.processing = true
    this.pumpLoop()
  }

  private pumpLoop(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const jobId = this.queue.shift()!
      void this.runJob(jobId)
    }
    this.processing = false
  }

  private async runJob(jobId: string): Promise<void> {
    const job = getJob(this.db, jobId)
    if (!job) return
    if (job.state === 'failed' || job.state === 'done') return
    this.running++
    const handler = this.handlers.get(job.kind)
    if (!handler) {
      updateJob(this.db, jobId, { state: 'failed', error: 'no handler', finishedAt: new Date().toISOString() })
      this.running--
      this.pump()
      return
    }
    // Mark started
    updateJob(this.db, jobId, {
      state: 'running',
      startedAt: new Date().toISOString(),
      attempts: job.attempts + 1
    })
    let cancelled = false
    const ctx: JobContext = {
      db: this.db,
      job: getJob(this.db, jobId)!,
      setStep: (label, progress) => {
        updateJob(this.db, jobId, { state: 'running', stepLabel: label, progress: progress ?? null })
        this.emit('progress', { ...getJob(this.db, jobId)!, state: 'running' })
      },
      isCancelled: () => cancelled
    }
    try {
      await handler(ctx)
      updateJob(this.db, jobId, { state: 'done', finishedAt: new Date().toISOString() })
      this.emit('done', getJob(this.db, jobId))
      this.emit('progress', getJob(this.db, jobId))
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (isTransientError(msg) && (job.attempts + 1) < 3) {
        // schedule retry with backoff
        updateJob(this.db, jobId, { state: 'queued', error: msg })
        const delay = 2000 * Math.pow(2, job.attempts)
        setTimeout(() => {
          this.queue.push(jobId)
          this.emit('retried', getJob(this.db, jobId))
          this.pump()
        }, delay)
      } else {
        updateJob(this.db, jobId, { state: 'failed', error: msg, finishedAt: new Date().toISOString() })
        this.emit('failed', getJob(this.db, jobId))
      }
      this.emit('progress', getJob(this.db, jobId))
    } finally {
      this.running--
      cancelled = true
      this.pump()
    }
  }

  // On startup, re-queue interrupted jobs (those stuck in running).
  requeueInterrupted(): number {
    const running = listRunningJobs(this.db)
    let count = 0
    for (const j of running) {
      if (j.state === 'running' || j.state === 'queued') {
        this.queue.push(j.id)
        count++
      }
    }
    // Interrupted ingestions too
    const active = listActiveIngest(this.db)
    for (const i of active) {
      this.ingestActive.add(i.taskId)
    }
    this.pump()
    return count
  }

  isRunning(jobId: string): boolean {
    const j = getJob(this.db, jobId)
    return !!j && (j.state === 'running' || j.state === 'queued')
  }
}

function ingestById(db: DatabaseSync, id: string): IngestRecord | null {
  return getIngest(db, id)
}

function updateIngestState(db: DatabaseSync, id: string, patch: IngestPatch): void {
  updateIngest(db, id, patch)
}

export type { IngestRecord }
