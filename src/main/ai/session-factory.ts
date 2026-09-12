import * as path from 'node:path'
import type { PluginGrant, Settings, TaskTypeDef } from '../../shared/types'
import { resolveGrant } from '../../core/domain/grant'
import type { SessionPurpose } from '../../core/ports/agent'

// Central factory for job agent sessions. Isolates all Pi session creation so
// jobs stay thin, and gives tests a seam to inject scripted sessions.
// The Pi SDK is loaded lazily so the override path (tests, no-key) never
// touches the ESM-only agent package.
//
// Plugin grant seam: skills and tool servers reachable by a session are decided
// HERE, at build time, from the run's PURPOSE and the type's declared grants.
// A confined run (material ingestion, minute polishing, suggestion generation)
// resolves to no grant at all — see `resolveGrant` in src/core/ports/agent.ts.
// The guarantee is architectural rather than conventional: no caller can pass a
// grant that a confined purpose would honour.

export interface JobSessionLike {
  subscribe: (cb: (ev: any) => void) => () => void
  prompt: (text: string, opts?: { expandPromptTemplates?: boolean }) => Promise<void>
  messages: any[]
  abort: () => Promise<void>
}

export interface CreateJobSessionOptions {
  settings: Settings
  cwd: string
  systemPrompt: string
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  tools: string[]
  customTools?: unknown[]
  noContextFiles?: boolean
  /** Why this session exists. Drives grant resolution. Defaults to 'confined'. */
  purpose?: SessionPurpose
  /** The type whose grants apply to an interactive session. */
  typeDef?: TaskTypeDef | null
  /** The already-resolved grant. Ignored for a confined purpose. */
  grant?: PluginGrant
}

export type JobSessionFactory = (opts: CreateJobSessionOptions) => Promise<JobSessionLike>

let overrideFactory: JobSessionFactory | null = null
let simplePromptOverride: ((prompt: string) => Promise<string>) | null = null

// Tests inject a scripted session factory here.
export function setSessionFactory(f: JobSessionFactory | null): void {
  overrideFactory = f
}

// Tests inject a scripted single-shot LLM response (suggestion jobs).
export function setSimplePromptOverride(f: ((prompt: string) => Promise<string>) | null): void {
  simplePromptOverride = f
}

export async function runScriptedSimplePrompt(prompt: string): Promise<string | null> {
  if (!simplePromptOverride) return null
  return simplePromptOverride(prompt)
}

export async function createJobSession(opts: CreateJobSessionOptions): Promise<JobSessionLike> {
  if (overrideFactory) return overrideFactory(opts)

  const { settings, cwd, systemPrompt, thinkingLevel, tools, customTools, noContextFiles } = opts
  const [{ createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager }, { getRuntime, resolveModel }, { piAgentDir, skillsDir }] =
    await Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('./agent-runtime'),
      import('../paths')
    ])

  // Grant resolution, at the seam. `purpose` defaults to 'confined' so a caller
  // that says nothing gets the safe answer: no external reach.
  const grant = resolveGrant({ purpose: opts.purpose ?? 'confined', typeDef: opts.typeDef ?? null })
  const grantedSkillPaths = grantedSkillDirs(grant, skillsDir())

  const runtime = await getRuntime()
  const model = resolveModel(settings.provider, settings.model)
  if (!model) throw new Error(`no model available for provider ${settings.provider}`)
  if (!settings.apiKey) throw new Error('AI not configured: no API key')

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: piAgentDir(),
    noContextFiles: noContextFiles ?? false,
    noExtensions: true,
    // Skills load only for a session that was granted one. A confined session
    // has `grantedSkillPaths` empty, so this is `true` — the confinement is
    // driven by the resolved grant, not by a flag the caller could set.
    noSkills: grantedSkillPaths.length === 0,
    additionalSkillPaths: grantedSkillPaths,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt
  })

  const { session } = await createAgentSession({
    cwd,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.create(cwd, piAgentDir()),
    tools,
    customTools: customTools as any[],
    noTools: 'builtin'
  })
  return session as unknown as JobSessionLike
}

/**
 * The skill directories a grant makes loadable.
 *
 * A skill is a CAPABILITY, never a permission: the SDK does not enforce a
 * skill's frontmatter `allowed-tools` (its docs label the field experimental),
 * so granting a skill widens what a session knows how to do, not what it may
 * do. Authority comes from grants alone.
 */
function grantedSkillDirs(grant: PluginGrant, root: string): string[] {
  return grant.skills.filter((name) => !!name).map((name) => path.join(root, name))
}
