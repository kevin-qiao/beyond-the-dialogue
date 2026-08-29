import { useState } from 'react'
import { useApp } from '../store'
import type { Settings } from '../../../shared/types'

const PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

export function SettingsView() {
  const { snapshot, saveSettings } = useApp()
  const [draft, setDraft] = useState<Settings | null>(snapshot?.settings ?? null)
  const [saved, setSaved] = useState(false)

  if (!draft) return <div className="view">Loading…</div>

  const update = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async () => {
    await saveSettings(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model ID
          <input
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-pro"
          />
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
