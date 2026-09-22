import * as path from 'node:path'
import type { PluginGrant, Settings, TaskTypeDef } from '../../shared/types'
import { resolveGrant } from '../../core/domain/grant'
import type { SessionPurpose } from '../../core/ports/agent'
import { buildMcpExtension } from '../adapters/agent/mcpAdapter'

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
  /**
   * End the session for good: extensions are told to shut down — which is
   * how pi-mcp-adapter tears down its (lazy) MCP child processes — and the
   * session's listeners are removed. abort() alone settles the turn but does
   * NOT emit session_shutdown; leaving a granted session undisposed would
   * leak the servers its proxy started. Optional so scripted test doubles
   * need not implement it.
   */
  dispose?: () => Promise<void>
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

  // MCP tool servers, from the SAME resolved grant: a session reaches the
  // outside network only through servers its type declared. This is the one
  // place the agent path reads settings.mcpServers (design D6's scan updated
  // by add-mcp-support); a confined run arrives with no tool servers, so it
  // constructs no adapter at all. A setup failure degrades the build rather
  // than failing the run — but it is reported, never swallowed (FR-024).
  const extensionFactories: unknown[] = []
  let mcpToolNames: string[] = []
  try {
    const mcp = await buildMcpExtension(settings.mcpServers ?? [], grant)
    if (mcp.extension) {
      extensionFactories.push(mcp.extension)
      mcpToolNames = mcp.toolNames
    }
    if (mcp.missingGranted.length)
      console.warn(`[mcp] type grants tool servers that are not configured: ${mcp.missingGranted.join(', ')}`)
  } catch (e) {
    console.warn('[mcp] tool-server setup failed; building the session without MCP:', e)
  }

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
    // Inline factories load even under noExtensions: true — that option only
    // suppresses DISCOVERED extensions, which is exactly the ambient behavior
    // the isolation contract forbids. The MCP adapter registers here (or not
    // at all); pi-mcp-adapter's inline-config mode also disables its own
    // interactive setup commands, so there is no code path to ambient files.
    extensionFactories: extensionFactories as never[],
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
    // The SDK allowlist must name every extension tool it should enable, so
    // the MCP proxy tool has to be added HERE (and nothing else — confined
    // runs have no mcpToolNames to add).
    tools: [...new Set([...tools, ...mcpToolNames])],
    customTools: customTools as any[],
    noTools: 'builtin'
  })

  // A granted session may have started (lazily) MCP child processes that only
  // the adapter's session_shutdown handler tears down. The SDK's own
  // runtime.dispose() emits that event then disposes; this in-memory job
  // session is not a runtime, so we replicate the order here: emit shutdown
  // first (stops the servers), then dispose (drops listeners). Skipping the
  // emit would leak every spawned server for the life of the main process.
  const raw = session as unknown as {
    subscribe: JobSessionLike['subscribe']
    prompt: JobSessionLike['prompt']
    messages: any[]
    abort: () => Promise<void>
    dispose: () => void
    extensionRunner?: { emit: (ev: { type: 'session_shutdown'; reason: 'quit' }) => Promise<unknown> }
  }
  return {
    subscribe: (cb) => raw.subscribe(cb),
    prompt: (text, o) => raw.prompt(text, o),
    get messages() {
      return raw.messages
    },
    abort: () => raw.abort(),
    dispose: async () => {
      try {
        await raw.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' })
      } catch (e) {
        console.warn('[mcp] session_shutdown emission failed:', e)
      }
      try {
        raw.dispose()
      } catch {
        // Dispose must not throw into a job's finally.
      }
    }
  }
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
