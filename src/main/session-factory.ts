import type { Settings } from '../shared/types'

// Central factory for job agent sessions. Isolates all Pi session creation so
// jobs stay thin, and gives tests a seam to inject scripted sessions.
// The Pi SDK is loaded lazily so the override path (tests, no-key) never
// touches the ESM-only agent package.

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
  const [{ createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager }, { getRuntime, resolveModel }, { piAgentDir }] =
    await Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('./agent-runtime'),
      import('./paths')
    ])

  const runtime = await getRuntime()
  const model = resolveModel(settings.provider, settings.model)
  if (!model) throw new Error(`no model available for provider ${settings.provider}`)
  if (!settings.apiKey) throw new Error('AI not configured: no API key')

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: piAgentDir(),
    noContextFiles: noContextFiles ?? false,
    noExtensions: true,
    noSkills: true,
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
