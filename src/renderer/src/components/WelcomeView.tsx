import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { Settings } from '../../../shared/types'

const SAMPLE_PAPER_URL = 'https://arxiv.org/abs/2301.00001'
const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

// One-time first-run welcome (spec first-run): explains the three-step flow,
// hosts the AI config card, and offers a sample paper to try immediately.
// Dismissed by Skip or by saving AI settings (main-side showWelcome flag).
export function WelcomeView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { snapshot, saveSettings, createTask } = useApp()
  const [draft, setDraft] = useState<Settings | null>(snapshot?.settings ?? null)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text?: string; error?: string } | null>(null)
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS)

  useEffect(() => {
    void window.api.listProviders().then((ps) => {
      if (ps.length > 0) setProviders(ps)
    })
  }, [])

  useEffect(() => {
    if (draft) void window.api.listModels(draft.provider).then(setModels)
  }, [draft?.provider])

  if (!draft) return null

  const update = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async () => {
    await saveSettings(draft)
  }

  const skip = async () => {
    await saveSettings({ ...draft, showWelcome: false })
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await window.api.testConnection(draft)
    setTestResult(res)
    setTesting(false)
  }

  const trySample = async () => {
    const listId = snapshot?.settings?.defaultListId ?? snapshot?.lists[0]?.id
    if (!listId) return
    await createTask({
      listId,
      title: 'NFTrig: Using Blockchain for Math Education',
      type: 'paper_reading',
      link: SAMPLE_PAPER_URL
    })
    // If AI is configured the analysis auto-starts (spec analysis-lifecycle).
    if (snapshot?.aiConfigured) await skip()
  }

  return (
    <div className="view welcome">
      <h2 className="welcome-title">Welcome to Work Board</h2>
      <p className="muted welcome-sub">A to-do board where an AI agent reads papers with you and files them into your personal wiki.</p>
      {onOpenSettings && (
        <div className="row welcome-settings-row">
          <button className="mini-btn" onClick={onOpenSettings}>
            ⚙ Open Settings
          </button>
        </div>
      )}

      <div className="welcome-steps">
        <div className="card">
          <h5>1 · Paste a paper link</h5>
          <p>arXiv / DOI / any publisher URL — the app creates the task and the agent starts reading it right away.</p>
        </div>
        <div className="card">
          <h5>2 · Read with the agent's help</h5>
          <p>TLDR, contributions, reading suggestions — take notes in markdown right next to the analysis.</p>
        </div>
        <div className="card">
          <h5>3 · Finish → it files itself into your wiki</h5>
          <p>Notes and summary land in your wiki (Obsidian-ready); index and log updated, nothing to configure.</p>
        </div>
      </div>

      <section className="settings-section">
        <h4>Connect an AI provider to get started</h4>
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
          <input list="model-options" value={draft.model} onChange={(e) => update({ model: e.target.value })} placeholder="e.g. gpt-4o, claude-sonnet-4-5" />
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          API key
          <input type="password" value={draft.apiKey ?? ''} onChange={(e) => update({ apiKey: e.target.value || null })} placeholder="sk-…" />
        </label>
        <div className="row">
          <button className="primary-btn" onClick={() => void save()}>
            Save &amp; start
          </button>
          <button className="mini-btn" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span className={testResult.ok ? 'ai-on' : 'error-text'}>
              {testResult.ok ? 'Connected' : `Failed: ${testResult.error ?? 'unknown error'}`}
            </span>
          )}
        </div>
      </section>

      <div className="row">
        <button className="finish-btn welcome-sample" onClick={() => void trySample()}>
          Try a sample paper →
        </button>
      </div>
      <button className="mini-btn welcome-skip" onClick={() => void skip()}>
        Skip — just show me the board (plain tasks work without AI)
      </button>
    </div>
  )
}
