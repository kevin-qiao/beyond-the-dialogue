import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import type { Settings } from '../../../../shared/types'

const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

// One-time first-run welcome (spec first-run): explains the three-step flow,
// hosts the AI config card, and offers a sample learning task to try
// immediately. Dismissed by Skip or by saving AI settings (main-side
// showWelcome flag).
export function WelcomeView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { snapshot, saveSettings, createTask } = useApp()
  const t = useT()
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
    // The sample becomes the user's own task, so it is created in the language
    // they are reading — and keeps that language afterwards, like any task.
    await createTask({
      listId,
      title: t('welcome.sample.title'),
      type: 'learning',
      inputs: { target: t('welcome.sample.target') }
    })
    // Adding the sample to My Day runs the learning pre-process once AI is
    // configured (spec task-types: per-type AI pre-processing).
    if (snapshot?.aiConfigured) await skip()
  }

  return (
    <div className="view welcome">
      <h2 className="welcome-title">{t('welcome.title')}</h2>
      <p className="muted welcome-sub">{t('welcome.sub')}</p>
      {onOpenSettings && (
        <div className="row welcome-settings-row">
          <button className="mini-btn" onClick={onOpenSettings}>
            ⚙ {t('welcome.openSettings')}
          </button>
        </div>
      )}

      <div className="welcome-steps">
        <div className="card">
          <h5>{t('welcome.step1.title')}</h5>
          <p>{t('welcome.step1.body')}</p>
        </div>
        <div className="card">
          <h5>{t('welcome.step2.title')}</h5>
          <p>{t('welcome.step2.body')}</p>
        </div>
        <div className="card">
          <h5>{t('welcome.step3.title')}</h5>
          <p>{t('welcome.step3.body')}</p>
        </div>
      </div>

      <section className="settings-section">
        <h4>{t('welcome.connect')}</h4>
        <label>
          {t('settings.ai.provider')}
          <select value={draft.provider} onChange={(e) => update({ provider: e.target.value })}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.ai.model')}
          <input list="model-options" value={draft.model} onChange={(e) => update({ model: e.target.value })} placeholder="e.g. gpt-4o, claude-sonnet-4-5" />
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          {t('settings.ai.apiKey')}
          <input type="password" value={draft.apiKey ?? ''} onChange={(e) => update({ apiKey: e.target.value || null })} placeholder="sk-…" />
        </label>
        <div className="row">
          <button className="primary-btn" onClick={() => void save()}>
            {t('welcome.saveAndStart')}
          </button>
          <button className="mini-btn" disabled={testing} onClick={() => void runTest()}>
            {testing ? t('settings.ai.testing') : t('settings.ai.test')}
          </button>
          {testResult && (
            <span className={testResult.ok ? 'ai-on' : 'error-text'}>
              {testResult.ok
                ? t('settings.ai.connected', { text: testResult.text || t('common.ok') })
                : t('settings.ai.failed', { error: testResult.error ?? t('task.preprocess.unknownError') })}
            </span>
          )}
        </div>
      </section>

      <div className="row">
        <button className="finish-btn welcome-sample" onClick={() => void trySample()}>
          {t('welcome.trySample')}
        </button>
      </div>
      <button className="mini-btn welcome-skip" onClick={() => void skip()}>
        {t('welcome.skip')}
      </button>
    </div>
  )
}
