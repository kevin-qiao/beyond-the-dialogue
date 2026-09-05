import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store'
import type { McpServerEntry, Settings, SkillEntry, TaskKind, TaskTypeDef } from '../../../../shared/types'
import { allTypeConfigs } from '../../lib/typeCatalog'
import { useDialog } from '../ui/Dialog'

const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

type Tab = 'general' | 'types' | 'plugins' | 'ai'

// Settings drawer (spec task-types / skills-mcp-settings): capsule tabs —
// General (appearance + wiki), Types (the workflow-type registry: built-in
// presentation editing + custom type CRUD), AI (provider/model/key). Types
// persist immediately through the types IPC; General/AI share a draft saved
// with the Save button.
export function SettingsView() {
  const { snapshot, types, saveSettings, saveType, deleteType } = useApp()
  const [tab, setTab] = useState<Tab>('general')

  const [draft, setDraft] = useState<Settings | null>(snapshot?.settings ?? null)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text?: string; error?: string } | null>(null)
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS)
  const [typeEditor, setTypeEditor] = useState<{ mode: 'add' | 'edit'; existing?: TaskTypeDef } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TaskTypeDef | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { confirm, dialog } = useDialog()

  // Reset the General/AI draft whenever the snapshot settings change so the
  // UI never lags behind the saved state.
  useEffect(() => {
    if (snapshot?.settings) setDraft(snapshot.settings)
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
    try {
      await saveSettings(draft)
      setSaved(true)
      setSaveError(null)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setSaveError(e?.message ?? String(e))
    }
  }

  const runTest = async () => {
    if (!draft) return
    setTesting(true)
    setTestResult(null)
    const res = await window.api.testConnection(draft)
    setTestResult(res)
    setTesting(false)
  }

  // Count tasks referencing a type key — shown on the delete confirm so the
  // user knows what'll fall back to plain.
  const referenceCount = (key: string) => (snapshot?.tasks ?? []).filter((t) => !t.deletedAt && t.customTypeKey === key).length

  const dirty = useMemo(() => {
    if (!draft) return false
    if (draft.theme !== snapshot?.settings.theme) return true
    if (draft.provider !== snapshot?.settings.provider) return true
    if (draft.model !== snapshot?.settings.model) return true
    if ((draft.apiKey ?? '') !== (snapshot?.settings.apiKey ?? '')) return true
    if (draft.wikiPath !== snapshot?.settings.wikiPath) return true
    if (JSON.stringify(draft.skills ?? []) !== JSON.stringify(snapshot?.settings.skills ?? [])) return true
    if (JSON.stringify(draft.mcpServers ?? []) !== JSON.stringify(snapshot?.settings.mcpServers ?? [])) return true
    return false
  }, [draft, snapshot?.settings])

  // The seed input schema a kind supports — taken from its built-in type.
  const kindSchema = (kind: TaskKind): TaskTypeDef['inputSchema'] =>
    types.find((t) => t.key === kind)?.inputSchema ?? []

  const builtinTypes = allTypeConfigs(types).filter((t) => t.isBuiltin)
  const customTypes = allTypeConfigs(types).filter((t) => !t.isBuiltin)

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
          {customTypes.length > 0 && <span className="tab-count">{customTypes.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'plugins'}
          className={`settings-tab ${tab === 'plugins' ? 'on' : ''}`}
          onClick={() => setTab('plugins')}
        >
          <span className="tab-ico">🔌</span>
          Plugins
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
          {typeError && <div className="warning-box"><p>{typeError}</p><button className="mini-btn" onClick={() => setTypeError(null)}>×</button></div>}
          <section className="settings-section">
            <div className="section-head">
              <h4>Built-in types</h4>
              <span className="muted">Presentation is editable; behavior is fixed</span>
            </div>
            <div className="type-card-grid">
              {builtinTypes.map((c) => (
                <div key={c.key} className="type-card builtin">
                  <div className="tc-emoji">{c.emoji}</div>
                  <div className="tc-main">
                    <div className="tc-label">{c.label}</div>
                    <code className="tc-key">{c.key} · {c.kind}</code>
                    {c.description && <div className="tc-desc">{c.description}</div>}
                  </div>
                  <div className="tc-actions">
                    <button className="icon-btn tiny" title="Edit presentation" onClick={() => setTypeEditor({ mode: 'edit', existing: c })}>
                      ✎
                    </button>
                    <span className="tc-badge">built-in</span>
                  </div>
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
            {customTypes.length === 0 ? (
              <div className="type-empty">
                <div className="te-emoji">📦</div>
                <div className="te-msg">No custom types yet</div>
                <div className="te-sub">Click “＋ New type” to wrap a built-in behavior kind with your own label, emoji, and input fields.</div>
              </div>
            ) : (
              <div className="type-card-grid">
                {customTypes.map((c) => (
                  <div key={c.key} className="type-card">
                    <div className="tc-emoji">{c.emoji}</div>
                    <div className="tc-main">
                      <div className="tc-label">{c.label}</div>
                      <code className="tc-key">{c.key} · {c.kind}</code>
                      {c.description && <div className="tc-desc">{c.description}</div>}
                    </div>
                    <div className="tc-actions">
                      <button className="icon-btn tiny" title="Edit" onClick={() => setTypeEditor({ mode: 'edit', existing: c })}>
                        ✎
                      </button>
                      <button className="icon-btn tiny danger" title="Delete" onClick={() => setPendingDelete(c)}>
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

      {tab === 'plugins' && draft && (
        <>
          {saveError && (
            <div className="warning-box">
              <p>Could not save: {saveError}</p>
              <button className="mini-btn" onClick={() => setSaveError(null)}>×</button>
            </div>
          )}
          <div className="inert-banner muted">
            Configured-only in this version — the built-in agent does not load skills or connect to MCP servers yet.
          </div>

          <SkillsSection
            skills={draft.skills ?? []}
            onChange={(skills) => update({ skills })}
            confirmRemove={async (name) => confirm({ title: 'Remove skill', message: `Remove skill “${name}”?`, confirmLabel: 'Remove', danger: true })}
          />
          <McpSection
            servers={draft.mcpServers ?? []}
            onChange={(mcpServers) => update({ mcpServers })}
            confirmRemove={async (name) => confirm({ title: 'Remove MCP server', message: `Remove MCP server “${name}”?`, confirmLabel: 'Remove', danger: true })}
          />
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
          takenKeys={new Set(allTypeConfigs(types).filter((c) => c !== typeEditor.existing).map((c) => c.key))}
          kindSchema={kindSchema}
          onSave={async (cfg) => {
            try {
              await saveType(cfg)
              setTypeEditor(null)
              setTypeError(null)
            } catch (e: any) {
              setTypeError(e?.message ?? String(e))
            }
          }}
          onClose={() => setTypeEditor(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteTypeModal
          config={pendingDelete}
          refCount={referenceCount(pendingDelete.key)}
          onConfirm={async () => {
            try {
              await deleteType(pendingDelete.key)
            } catch (e: any) {
              setTypeError(e?.message ?? String(e))
            }
            setPendingDelete(null)
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
      {dialog}
    </div>
  )
}

// Skills management (spec skills-mcp-settings): unique name + description,
// add/edit/remove with confirmation. Entries persist with settings; inert in
// v0.8 (see src/main/plugins.ts).
function SkillsSection({
  skills,
  onChange,
  confirmRemove
}: {
  skills: SkillEntry[]
  onChange: (next: SkillEntry[]) => void
  confirmRemove: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const dup = (n: string, except?: string) => skills.some((s) => s.name === n && s.name !== except)

  const add = () => {
    const n = name.trim()
    if (!n) return setError('Name is required')
    if (dup(n)) return setError(`Skill "${n}" already exists — names must be unique`)
    if (!description.trim()) return setError('Description is required')
    onChange([...skills, { name: n, description: description.trim() }])
    setName('')
    setDescription('')
    setError(null)
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <h4>Skills</h4>
        <span className="muted">not yet active — configuration only</span>
      </div>
      {skills.map((s, i) => (
        <div key={s.name} className="plugin-row">
          <input value={s.name} disabled title="Name is the key" className="plugin-name" />
          <input
            value={s.description}
            placeholder="Description"
            onChange={(e) => onChange(skills.map((x, xi) => (xi === i ? { ...x, description: e.target.value } : x)))}
          />
          <button
            className="icon-btn tiny danger"
            title="Remove"
            onClick={() =>
              void confirmRemove(s.name).then((ok) => {
                if (ok) onChange(skills.filter((x) => x.name !== s.name))
              })
            }
          >
            🗑
          </button>
        </div>
      ))}
      {skills.length === 0 && <div className="type-empty"><div className="te-msg">No skills yet</div></div>}
      <div className="plugin-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this skill does" />
        <button className="mini-btn primary" onClick={add}>
          ＋ Add
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

// MCP server management (spec skills-mcp-settings): unique name + a complete
// stdio transport (command; optional args/env) validated before persistence
// (renderer checks shape; main re-validates on save).
function McpSection({
  servers,
  onChange,
  confirmRemove
}: {
  servers: McpServerEntry[]
  onChange: (next: McpServerEntry[]) => void
  confirmRemove: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const n = name.trim()
    if (!n) return setError('Name is required')
    if (servers.some((s) => s.name === n)) return setError(`MCP server "${n}" already exists — names must be unique`)
    if (!command.trim()) return setError('A command is required for the stdio transport')
    onChange([
      ...servers,
      { name: n, transport: { type: 'stdio', command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : undefined } }
    ])
    setName('')
    setCommand('')
    setArgs('')
    setError(null)
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <h4>MCP servers</h4>
        <span className="muted">not yet active — configuration only</span>
      </div>
      {servers.map((s, i) => (
        <div key={s.name} className="plugin-row">
          <input value={s.name} disabled title="Name is the key" className="plugin-name" />
          <input
            value={s.transport.command}
            placeholder="command"
            onChange={(e) =>
              onChange(servers.map((x, xi) => (xi === i ? { ...x, transport: { ...x.transport, command: e.target.value } } : x)))
            }
          />
          <input
            value={(s.transport.args ?? []).join(' ')}
            placeholder="args (space-separated)"
            onChange={(e) =>
              onChange(
                servers.map((x, xi) =>
                  xi === i ? { ...x, transport: { ...x.transport, args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : undefined } } : x
                )
              )
            }
          />
          <button
            className="icon-btn tiny danger"
            title="Remove"
            onClick={() =>
              void confirmRemove(s.name).then((ok) => {
                if (ok) onChange(servers.filter((x) => x.name !== s.name))
              })
            }
          >
            🗑
          </button>
        </div>
      ))}
      {servers.length === 0 && <div className="type-empty"><div className="te-msg">No MCP servers yet</div></div>}
      <div className="plugin-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command (e.g. npx)" />
        <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y some-mcp-server" />
        <button className="mini-btn primary" onClick={add}>
          ＋ Add
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

// Modal: add or edit a workflow type. Custom types choose a behavior kind and
// a subset of that kind's supported input fields; built-in types expose only
// presentation (label/emoji/description). Key is fixed on edit.
function TypeEditorModal({
  mode,
  existing,
  takenKeys,
  kindSchema,
  onSave,
  onClose
}: {
  mode: 'add' | 'edit'
  existing?: TaskTypeDef
  takenKeys: Set<string>
  kindSchema: (kind: TaskKind) => TaskTypeDef['inputSchema']
  onSave: (cfg: TaskTypeDef) => Promise<void>
  onClose: () => void
}) {
  const isBuiltinEdit = mode === 'edit' && !!existing?.isBuiltin
  const [key, setKey] = useState(existing?.key ?? '')
  const [kind, setKind] = useState<TaskKind>(existing?.kind ?? 'learning')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📌')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [aiGuidance, setAiGuidance] = useState(existing?.aiGuidance ?? '')
  const supported = kindSchema(kind)
  const [fieldKeys, setFieldKeys] = useState<Set<string>>(
    new Set(existing && !existing.isBuiltin ? existing.inputSchema.map((f) => f.key) : supported.map((f) => f.key))
  )
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const k = key.trim().replace(/\s+/g, '_').toLowerCase()
    if (!existing) {
      if (!k) return setError('Key is required')
      if (!/^[a-z0-9_]{2,32}$/.test(k)) return setError('Key must be lowercase letters, digits, underscore (2–32 chars)')
      if (takenKeys.has(k)) return setError(`Key "${k}" is already used`)
    }
    if (!label.trim()) return setError('Label is required')
    if (!emoji.trim()) return setError('Emoji is required')
    const inputSchema = existing?.isBuiltin ? existing.inputSchema : supported.filter((f) => fieldKeys.has(f.key))
    void onSave({
      key: existing?.key ?? k,
      kind: existing?.isBuiltin ? existing.kind : kind,
      label: label.trim(),
      emoji: emoji.trim().slice(0, 4),
      description: description.trim() || undefined,
      inputSchema,
      aiGuidance: (!existing?.isBuiltin && aiGuidance.trim()) || undefined,
      isBuiltin: existing?.isBuiltin ?? false
    })
  }

  const toggleField = (fk: string) =>
    setFieldKeys((cur) => {
      const next = new Set(cur)
      if (next.has(fk)) next.delete(fk)
      else next.add(fk)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">{mode === 'add' ? '＋ NEW' : '✎ EDIT'}</span>
          <h3>{mode === 'add' ? 'New type' : existing?.isBuiltin ? 'Edit built-in presentation' : 'Edit type'}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              Key
              <input value={key} disabled={mode === 'edit'} onChange={(e) => setKey(e.target.value)} placeholder="e.g. code_review" spellCheck={false} />
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
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this type is for" />
          </label>
          {!isBuiltinEdit && (
            <>
              <label>
                Behavior kind
                <select value={kind} disabled={mode === 'edit'} onChange={(e) => setKind(e.target.value as TaskKind)}>
                  <option value="plain">plain — notes &amp; suggestion chips only</option>
                  <option value="learning">learning — prompt/summary, note editor, wiki ingest on Finish</option>
                  <option value="jira">jira — pasted source, chat, comment drafts</option>
                </select>
              </label>
              {mode === 'add' && (
                <div className="tif-fields">
                  <span className="tif-label">Input fields (from this kind)</span>
                  {supported.map((f) => (
                    <label key={f.key} className="tif-check">
                      <input type="checkbox" checked={fieldKeys.has(f.key)} onChange={() => toggleField(f.key)} />
                      {f.label}
                      {f.required && <span className="tif-required"> *</span>}
                      {f.inert && <span className="muted"> (not yet active)</span>}
                    </label>
                  ))}
                </div>
              )}
              <label>
                AI guidance <span className="muted">(optional — appended to this type's pre-process prompt)</span>
                <textarea value={aiGuidance} onChange={(e) => setAiGuidance(e.target.value)} rows={3} placeholder="e.g. Focus on security review angles." />
              </label>
            </>
          )}
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
  config: TaskTypeDef
  refCount: number
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag danger">🗑 DELETE</span>
          <h3>Delete type “{config.label}”?</h3>
        </div>
        <div className="modal-body">
          <p>
            {refCount > 0
              ? `${refCount} task(s) use this type. They will fall back to plain; their titles, notes, lists, and completion state are kept.`
              : 'No tasks currently use this type.'}
          </p>
          <p className="muted">The type itself is removed from pickers and this Settings list.</p>
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
