import { ModelRuntime, type CreateModelRuntimeOptions } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai/compat'
import { getModel, getModels, getProviders } from '@earendil-works/pi-ai/compat'
import type { ThinkingLevel } from '@earendil-works/pi-ai'
import type { ChatMessage, Settings } from '../shared/types'
import { piAgentDir, piAuthPath, piModelsPath } from './paths'
import * as fs from 'node:fs'
import { isConfigured } from './ai-config'

// Thin adapter around the Pi SDK. All Pi usage outside this module goes
// through this wrapper so SDK upgrades touch exactly one place.

let runtime: ModelRuntime | null = null
let runtimeInit: Promise<ModelRuntime> | null = null

export function getRuntime(): Promise<ModelRuntime> {
  if (runtime) return Promise.resolve(runtime)
  if (runtimeInit) return runtimeInit
  fs.mkdirSync(piAgentDir(), { recursive: true })
  const opts: CreateModelRuntimeOptions = {
    authPath: piAuthPath(),
    modelsPath: piModelsPath(),
    refreshOnCreate: false,
    allowModelNetwork: false
  }
  runtimeInit = ModelRuntime.create(opts).then((r) => {
    runtime = r
    return r
  })
  return runtimeInit
}

export function applyApiKey(r: ModelRuntime, provider: string, apiKey: string): Promise<void> {
  return r.setRuntimeApiKey(provider as any, apiKey)
}

export function clearApiKey(r: ModelRuntime, provider: string): Promise<void> {
  return r.removeRuntimeApiKey(provider as any)
}

export function hasConfiguredAuth(r: ModelRuntime, provider: string): boolean {
  try {
    return r.hasConfiguredAuth(provider as any)
  } catch {
    return false
  }
}

export function resolveModel(provider: string, modelId: string): Model<any> | null {
  try {
    if (modelId) {
      const m = getModel(provider as any, modelId)
      if (m) return m as Model<any>
    }
    const models = getModels(provider as any) as Model<any>[]
    return models[0] ?? null
  } catch {
    return null
  }
}

export async function listModelsForProvider(provider: string): Promise<string[]> {
  try {
    return (getModels(provider as any) as Model<any>[]).map((m) => m.id)
  } catch {
    return []
  }
}

export function listProviders(): string[] {
  // The bundled pi catalog ships dozens of providers (see pi.dev/docs/latest/
  // providers); expose them dynamically with a conservative fallback.
  try {
    const ps = getProviders() as unknown[]
    const ids = ps
      .map((p: any) => (typeof p === 'string' ? p : p?.id))
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length > 0) return ids
  } catch {
    // fall through
  }
  return ['openai', 'anthropic', 'google', 'xai']
}

export { isConfigured } from './ai-config'

export async function configureRuntimeFromSettings(settings: Settings): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await getRuntime()
    if (!settings.apiKey) return { ok: true }
    await applyApiKey(r, settings.provider, settings.apiKey)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

export async function testPrompt(settings: Settings, prompt: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const r = await getRuntime()
    const model = resolveModel(settings.provider, settings.model)
    if (!model) return { ok: false, error: `no model available for provider ${settings.provider}` }
    await configureRuntimeFromSettings(settings)
    const res = await r.completeSimple(model, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, { reasoning: 'low' })
    const text = res.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
    return { ok: true, text }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

export async function runSimplePrompt(
  settings: Settings,
  prompt: string,
  opts: { reasoning?: ThinkingLevel } = {}
): Promise<string> {
  const r = await getRuntime()
  const model = resolveModel(settings.provider, settings.model)
  if (!model) throw new Error(`no model available for provider ${settings.provider}`)
  await configureRuntimeFromSettings(settings)
  const res = await r.completeSimple(model, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, { reasoning: opts.reasoning ?? 'low' })
  return res.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
}

// Debug chat (connection check): a streaming multi-turn conversation against
// the configured model. History is supplied by the caller (ChatSession in
// chat.ts); deltas are pushed to onDelta as tokens arrive.
export async function streamChat(
  settings: Settings,
  history: ChatMessage[],
  onDelta: (delta: string) => void
): Promise<string> {
  const r = await getRuntime()
  const model = resolveModel(settings.provider, settings.model)
  if (!model) throw new Error(`no model available for provider ${settings.provider}`)
  await configureRuntimeFromSettings(settings)
  const messages = history.map((m) => ({ role: m.role, content: m.content, timestamp: Date.now() }))
  const stream = r.streamSimple(model, { messages }, { reasoning: 'low' })
  let text = ''
  for await (const ev of stream) {
    if (ev.type === 'text_delta') {
      text += ev.delta
      onDelta(ev.delta)
    }
  }
  if (text) return text
  // Providers that emit no deltas: fall back to the final message content.
  const result = await stream.result()
  return result.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
}
