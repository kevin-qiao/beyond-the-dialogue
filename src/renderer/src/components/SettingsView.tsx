import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import type { Settings, TaskTypeConfig } from '../../../shared/types'
import { BUILTIN_TYPE_CONFIGS, allTypeConfigs } from '../shared/typeCatalog'

const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

type Tab = 'general' | 'types' | 'ai'

// Settings drawer v2 (docs/workboard-ux.html): three capsule tabs at the top
// (General / Types / AI), each section is its own card. The Types tab owns the
// built-in catalog (read-only info cards) and the user's custom types (full
// add/edit/delete). Add/edit opens a modal editor.
export function SettingsView() {
  const { snapshot, saveSettings } = useApp()
  const [tab, setTab] = useState<Tab>('general')

  // Drafts live per-tab because each tab has independent save semantics.
  // General + AI share one Settings draft; Types is a separate customTypes
  // draft that's never persisted until the user clicks "Save".
  const [draft, setDraft] = useState<Settings | null>(snapshot?.settings ?? null)
  const [typesDraft, setTypesDraft] = useState<TaskTypeConfig[]>(snapshot?.settings?.customTypes ?? [])
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text?: string; error?: string } | null>(null)
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS)
  const [typeEditor, setTypeEditor] = useState<{ mode: 'add' | 'edit'; existing?: TaskTypeConfig } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TaskTypeConfig | null>(null)

  // Reset drafts whenever the snapshot changes (e.g. AI configured, list
  // selected) so the UI never lags behind the saved state.
  useEffect(() => {
    if (snapshot?.settings) {
      setDraft(snapshot.settings)
      setTypesDraft(snapshot.settings.customTypes ?? [])
    }
  }, [snapshot?.settings])

  useEffect(() => {
    void window.api.listProviders().then((ps) => {
      if (ps.length > 0) setProviders(ps)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.listModels(draft?.provider ?? 'openai').then((m) => {
      if (!cancelled) setModels(m)
    })
    return () => {
      cancelled = true
    }
  }, [draft?.provider])

  const update = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async () => {
    if (!draft) return
    // Merge typesDraft into the settings draft so both tabs persist together.
    const merged: Settings = { ...draft, customTypes: typesDraft }
    await saveSettings(merged)
    setDraft(merged)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const runTest = async () => {
    if (!draft) return
    setTesting(true)
    setTestResult(null)
    const res = await window.api.testConnection(draft)
    setTestResult(res)
    setTesting(false)
  }

  // Count tasks referencing a custom type key — shown on the delete confirm
  // so the user knows what'll be affected.
  const referenceCount = (key: string) =>
    (snapshot?.tasks ?? []).filter((t) => !t.deletedAt && (t.customTypeKey === key || (t.type as string) === key)).length

  const dirty = useMemo(() => {
    if (!draft) return false
    const origTypes = snapshot?.settings?.customTypes ?? []
    if (draft.theme !== snapshot?.settings.theme) return true
    if (draft.provider !== snapshot?.settings.provider) return true
    if (draft.model !== snapshot?.settings.model) return true
    if ((draft.apiKey ?? '') !== (snapshot?.settings.apiKey ?? '')) return true
    if (draft.wikiPath !== snapshot?.settings.wikiPath) return true
    if (typesDraft.length !== origTypes.length) return true
    for (let i = 0; i < typesDraft.length; i++) {
      const draftType = typesDraft[i]
      const orig = origTypes[i]
      if (!draftType || !orig) return true
      if (draftType.key !== orig.key) return true
      if (draftType.label !== orig.label) return true
      if (draftType.emoji !== orig.emoji) return true
      if ((draftType.description ?? '') !== (orig.description ?? '')) return true
    }
    return false
  }, [draft, typesDraft, snapshot?.settings])

  if (!draft) return <div className="view">Loading…</div>

  return (
    <div className="view settings-view">
      <div className="view-head">
        <h2>Settings</h2>
        <button className="primary-btn" disabled={!dirty} onClick={() => void save()}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button
          role="tab"
          aria-selected={tab === 'general'}
          className={`settings-tab ${tab === 'general' ? 'on' : ''}`}
          onClick={() => setTab('general')}
        >
          <span className="tab-ico">⚙</span>
          General
        </button>
        <button
          role="tab"
          aria-selected={tab === 'types'}
          className={`settings-tab ${tab === 'types' ? 'on' : ''}`}
          onClick={() => setTab('types')}
        >
          <span className="tab-ico">▤</span>
          Types
          {typesDraft.length > 0 && <span className="tab-count">{typesDraft.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'ai'}
          className={`settings-tab ${tab === 'ai' ? 'on' : ''}`}
          onClick={() => setTab('ai')}
        >
          <span className="tab-ico">✦</span>
          AI
        </button>
      </div>

      {tab === 'general' && (
        <>
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
            {snapshot?.aiConfigured ? (
              <span className="ai-on">AI is configured · {draft.provider} / {draft.model || 'no model'}</span>
            ) : (
              <span className="ai-off">AI not configured — non-AI features still work. Configure in the AI tab.</span>
            )}
          </div>
        </>
      )}

      {tab === 'types' && (
        <>
          <section className="settings-section">
            <div className="section-head">
              <h4>Built-in types</h4>
              <span className="muted">系统内置，不可删除</span>
            </div>
            <div className="type-card-grid">
              {BUILTIN_TYPE_CONFIGS.map((c) => (
                <div key={c.key} className="type-card builtin">
                  <div className="tc-emoji">{c.emoji}</div>
                  <div className="tc-main">
                    <div className="tc-label">{c.label}</div>
                    <code className="tc-key">{c.key}</code>
                    {c.description && <div className="tc-desc">{c.description}</div>}
                  </div>
                  <span className="tc-badge">内置</span>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="section-head">
              <h4>Custom types</h4>
              <button className="mini-btn primary" onClick={() => setTypeEditor({ mode: 'add' })}>
                ＋ New type
              </button>
            </div>
            {typesDraft.length === 0 ? (
              <div className="type-empty">
                <div className="te-emoji">📦</div>
                <div className="te-msg">还没有自定义类型</div>
                <div className="te-sub">点击「＋ New type」创建第一个，或在右侧 AI tab 让 AI 帮你生成</div>
              </div>
            ) : (
              <div className="type-card-grid">
                {typesDraft.map((c) => (
                  <div key={c.key} className="type-card">
                    <div className="tc-emoji">{c.emoji}</div>
                    <div className="tc-main">
                      <div className="tc-label">{c.label}</div>
                      <code className="tc-key">{c.key}</code>
                      {c.description && <div className="tc-desc">{c.description}</div>}
                    </div>
                    <div className="tc-actions">
                      <button
                        className="icon-btn tiny"
                        title="Edit"
                        onClick={() => setTypeEditor({ mode: 'edit', existing: c })}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn tiny danger"
                        title="Delete"
                        onClick={() => setPendingDelete(c)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'ai' && (
        <>
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
        </>
      )}

      {typeEditor && (
        <TypeEditorModal
          mode={typeEditor.mode}
          existing={typeEditor.existing}
          takenKeys={new Set([
            ...BUILTIN_TYPE_CONFIGS.map((c) => c.key),
            ...typesDraft.filter((c) => c !== typeEditor.existing).map((c) => c.key)
          ])}
          onSave={(cfg) => {
            setTypesDraft((cur) => {
              if (typeEditor.mode === 'add') return [...cur, cfg]
              return cur.map((c) => (c.key === typeEditor.existing?.key ? cfg : c))
            })
            setTypeEditor(null)
          }}
          onClose={() => setTypeEditor(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteTypeModal
          config={pendingDelete}
          refCount={referenceCount(pendingDelete.key)}
          onConfirm={() => {
            setTypesDraft((cur) => cur.filter((c) => c.key !== pendingDelete.key))
            setPendingDelete(null)
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

// Modal: add or edit a custom task type. Key is editable only on add (you can
// always rename the label later). Built-in keys are blocked.
function TypeEditorModal({
  mode,
  existing,
  takenKeys,
  onSave,
  onClose
}: {
  mode: 'add' | 'edit'
  existing?: TaskTypeConfig
  takenKeys: Set<string>
  onSave: (cfg: TaskTypeConfig) => void
  onClose: () => void
}) {
  const [key, setKey] = useState(existing?.key ?? '')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📌')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const k = key.trim().replace(/\s+/g, '_').toLowerCase()
    if (!k) return setError('Key 不能为空')
    if (!/^[a-z0-9_]{2,32}$/.test(k)) return setError('Key 只能包含小写字母、数字、下划线（2–32 字符）')
    if (mode === 'add' && takenKeys.has(k)) return setError(`Key「${k}」已被使用`)
    if (!label.trim()) return setError('Label 不能为空')
    if (!emoji.trim()) return setError('Emoji 不能为空')
    onSave({
      key: k,
      label: label.trim(),
      emoji: emoji.trim().slice(0, 4),
      description: description.trim() || undefined,
      isCustom: true
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">{mode === 'add' ? '＋ NEW' : '✎ EDIT'}</span>
          <h3>{mode === 'add' ? 'New type' : 'Edit type'}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              Key
              <input
                value={key}
                disabled={mode === 'edit'}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. code_review"
                spellCheck={false}
              />
            </label>
            <label style={{ width: 80 }}>
              Emoji
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
            </label>
          </div>
          <label>
            Label
            <input autoFocus={mode === 'add'} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Code review" />
          </label>
          <label>
            Description <span className="muted">（可选）</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述这个类型的用途" />
          </label>
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={submit}>
            {mode === 'add' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteTypeModal({
  config,
  refCount,
  onConfirm,
  onClose
}: {
  config: TaskTypeConfig
  refCount: number
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag danger">🗑 DELETE</span>
          <h3>Delete type「{config.label}」?</h3>
        </div>
        <div className="modal-body">
          <p>
            {refCount > 0
              ? `当前有 ${refCount} 个任务使用此类型。删除后这些任务将回退到 plain 任务，原 customTypeKey 会被清空。`
              : '当前没有任务使用此类型。'}
          </p>
          <p className="muted">任务本身的标题、笔记和其他字段不会被修改。</p>
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="danger-btn" onClick={onConfirm}>
            Delete type
          </button>
        </div>
      </div>
    </div>
  )
}
