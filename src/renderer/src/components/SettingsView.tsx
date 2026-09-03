import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Settings } from '../../../shared/types'

const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

export function SettingsView() {
  const { snapshot, saveSettings } = useApp()
  const [draft, setDraft] = useState<Settings | null>(snapshot?.settings ?? null)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text?: string; error?: string } | null>(null)
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS)

  // Provider list comes from the pi catalog (38+ providers); fall back to a
  // curated subset if the catalog is unavailable.
  useEffect(() => {
    void window.api.listProviders().then((ps) => {
      if (ps.length > 0) setProviders(ps)
    })
  }, [])

  // Model dropdown (spec first-run): populated from the provider's model
  // registry; free-text entry stays available as a fallback.
  useEffect(() => {
    let cancelled = false
    void window.api.listModels(draft?.provider ?? 'openai').then((m) => {
      if (!cancelled) setModels(m)
    })
    return () => {
      cancelled = true
    }
  }, [draft?.provider])

  if (!draft) return <div className="view">Loading…</div>

  const update = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async () => {
    await saveSettings(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await window.api.testConnection(draft)
    setTestResult(res)
    setTesting(false)
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2>Settings</h2>
        <button className="primary-btn" onClick={() => void save()}>
          Save
        </button>
        {saved && <span className="badge ok">saved</span>}
      </div>

      <section className="settings-section">
        <h4>AI provider</h4>
        <label>
          Provider
          <select value={draft.provider} onChange={(e) => update({ provider: e.target.value })}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input
            list="model-options"
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-pro"
          />
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          API key <span className="muted">(stored in the app's private data dir)</span>
          <input
            type="password"
            value={draft.apiKey ?? ''}
            onChange={(e) => update({ apiKey: e.target.value || null })}
            placeholder="sk-…"
          />
        </label>
        <div className="row">
          <button className="mini-btn" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span className={testResult.ok ? 'ai-on' : 'error-text'}>
              {testResult.ok ? `Connected — model replied: ${testResult.text ?? 'OK'}` : `Failed: ${testResult.error ?? 'unknown error'}`}
            </span>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h4>Appearance</h4>
        <label>
          Theme <span className="muted">(applies immediately, saved on Save)</span>
          <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as 'light' | 'dark' })}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h4>Learning space (wiki)</h4>
        <label>
          Wiki directory <span className="muted">(created automatically on first use)</span>
          <input value={draft.wikiPath} onChange={(e) => update({ wikiPath: e.target.value })} placeholder="~/Documents/WorkBoard-Wiki" />
        </label>
      </section>

      <div className="ai-status-card">
        {snapshot?.aiConfigured ? <span className="ai-on">AI is configured</span> : <span className="ai-off">AI not configured — non-AI features still work</span>}
      </div>
    </div>
  )
}
