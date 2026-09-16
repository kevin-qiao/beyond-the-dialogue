import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  ArtifactRef,
  ArtifactStorePort,
  DepositParts,
  DepositResult,
  DestinationRef,
  SnapshotHandle
} from '../../../core/ports/artifactStore'
import { distinctName } from '../../../core/domain/slug'
import { LocalizedError } from '../../../core/i18n/issues'
import { depositInto } from './deposit'
import {
  diffTouchedFiles,
  ensureWikiDir,
  listExistingWikiFiles,
  snapshotWikiFiles
} from '../../wiki/wiki'

// The wiki artifact store: `deposit-then-curate`'s destination.
//
// It delegates to the existing wiki functions unchanged rather than
// reimplementing them. That is deliberate (research R4): the deposit-first
// ordering, the create-only scaffolding, the .history snapshots and the
// confined curating agent are the reasons this flow is trustworthy, and SC-003
// requires the learning flow to behave identically. Introducing the port is
// the whole change — the internals are the ones that already work.

export class WikiArtifactStore implements ArtifactStorePort {
  constructor(private readonly wikiRoot: string) {}

  private subdirOf(target: DestinationRef): string {
    return target.subdir ?? ''
  }

  async prepare(target: DestinationRef): Promise<void> {
    try {
      // Create-only: an existing wiki is reused, never restructured.
      ensureWikiDir(this.wikiRoot)
    } catch (e: any) {
      throw new LocalizedError([{ key: 'artifact.wikiUnusable', params: { error: e?.message ?? String(e) } }])
    }
    if (!fs.existsSync(target.absRoot)) {
      fs.mkdirSync(target.absRoot, { recursive: true })
    }
    try {
      fs.accessSync(target.absRoot, fs.constants.W_OK)
    } catch {
      throw new LocalizedError([{ key: 'artifact.wikiNotWritable', params: { path: target.absRoot } }])
    }
  }

  async writeArtifact(target: ArtifactRef, content: string): Promise<string> {
    fs.mkdirSync(path.dirname(target.abs), { recursive: true })
    const ext = path.extname(target.rel) || '.md'
    const base = path.basename(target.rel, ext)
    const name = distinctName(base, ext, (n) => fs.existsSync(path.join(target.absRoot, n)))
    const dest = path.join(target.absRoot, name)
    fs.writeFileSync(dest, content, 'utf-8')
    return dest
  }

  async deposit(target: ArtifactRef, parts: DepositParts): Promise<DepositResult> {
    // Create-only scaffolding first: the curating agent reads the wiki schema
    // file and updates index.md/log.md, so the structure must exist before the
    // deposit lands. An existing wiki is reused, never restructured.
    ensureWikiDir(this.wikiRoot)
    // The wiki's raw area lives under the wiki root, not under the artifact
    // subdir — that is the existing convention the ingest workflow reads.
    return depositInto(path.join(this.wikiRoot, 'raw', parts.taskId), parts)
  }

  async snapshot(target: DestinationRef): Promise<SnapshotHandle> {
    const subdir = this.subdirOf(target)
    const before = listExistingWikiFiles(this.wikiRoot, subdir)
    const touched = snapshotWikiFiles(this.wikiRoot, [], subdir)
    const historyRoot = path.join(this.wikiRoot, '.history')
    const stamps = fs.existsSync(historyRoot) ? fs.readdirSync(historyRoot).sort() : []
    return {
      store: 'wiki',
      root: this.wikiRoot,
      subdir,
      location: stamps.length ? path.join(historyRoot, stamps[stamps.length - 1]!) : null,
      // `snapshotWikiFiles` returns what it actually backed up; `before` is
      // what existed. They agree, but the backup list is the authoritative one.
      files: touched.length ? touched : before
    }
  }

  async diff(handle: SnapshotHandle): Promise<string[]> {
    // The wiki reports artifact paths relative to the wiki root, which is what
    // the ingest ledger and the Activity view show.
    return diffTouchedFiles(handle.root, handle.subdir)
  }
}

export const wikiArtifactStoreFor = (wikiRoot: string): ArtifactStorePort => new WikiArtifactStore(wikiRoot)
