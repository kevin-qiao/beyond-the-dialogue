import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store'
import type { Destination, DestinationStore, FinishBehaviour, McpServerEntry, Settings, SkillEntry, TaskKind, TaskTypeDef } from '../../../../shared/types'
import { SETTINGS_KEYS } from '../../../../shared/types'
import { FINISH_BEHAVIOURS } from '../../../../core/domain/categories'
import { describeDestination } from '../../../../core/domain/destination'
import { describeMcpServer, parseMcpJsonPaste } from '../../../../core/domain/mcpConfig'
import { LANGUAGES, LANGUAGE_NAMES, isLanguage, type MessageKey } from '../../../../core/i18n'
import { useLanguage, useT } from '../../lib/useT'
import { allTypeConfigs, displayTypeDescription, displayTypeLabel, localizeTypeDef } from '../../lib/typeCatalog'
import { useDialog } from '../ui/Dialog'

const FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google', 'xai']

// The behaviour a brand-new type starts on: writes nothing, needs no
// destination, so a half-filled form can always be saved.
const DEFAULT_FINISH_BEHAVIOUR: FinishBehaviour = 'complete-only'

// Plain-language descriptions of the closed set of four (FR-014). A user
// choosing a behaviour is choosing what happens to their work, so the list
// says what each one does rather than naming it and stopping.
const FINISH_BEHAVIOUR_LABELS: Record<FinishBehaviour, MessageKey> = {
  'complete-only': 'finishBehaviour.completeOnly',
  'file-as-is': 'finishBehaviour.fileAsIs',
  'polish-then-file': 'finishBehaviour.polishThenFile',
  'deposit-then-curate': 'finishBehaviour.depositThenCurate'
}

type Tab = 'general' | 'types' | 'plugins' | 'ai'

// Settings drawer (spec task-types / skills-mcp-settings): capsule tabs —
// General (appearance), Types (the workflow-type registry: built-in
// presentation and destination editing + custom type CRUD), AI
// (provider/model/key). Types persist immediately through the types IPC;
// General/AI share a draft saved with the Save button. The wiki directory is
// NOT a setting here — a `store: wiki` type declares its own destination on
// the Types tab, and with none configured a Finish is refused.
export function SettingsView() {
  const { snapshot, types, saveSettings, saveType, deleteType } = useApp()
  const t = useT()
  const language = useLanguage()
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

  // Does the draft differ from what is saved? Driven by SETTINGS_KEYS rather
  // than a hand-written list of comparisons: a setting missing from the list
  // fails silently — the field edits fine and Save simply never enables — so
  // the list is read from the one declaration of the field set instead.
  const dirty = useMemo(() => {
    if (!draft || !snapshot?.settings) return false
    const saved = snapshot.settings
    return SETTINGS_KEYS.some((key) => {
      const a = draft[key]
      const b = saved[key]
      // The two object-valued settings (skills, mcpServers) are edited in
      // place, so identity comparison would always report a change.
      if (typeof a === 'object' || typeof b === 'object') {
        return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
      }
      return a !== b
    })
  }, [draft, snapshot?.settings])

  // The seed input schema a kind supports — taken from its built-in type.
  const kindSchema = (kind: TaskKind): TaskTypeDef['inputSchema'] =>
    types.find((t) => t.key === kind)?.inputSchema ?? []

  const builtinTypes = allTypeConfigs(types).filter((t) => t.isBuiltin)
  const customTypes = allTypeConfigs(types).filter((t) => !t.isBuiltin)

  if (!draft) return <div className="view">{t('app.loading')}</div>

  return (
    <div className="view settings-view">
      <div className="view-head">
        <h2>{t('drawer.settings.title')}</h2>
        <button className="primary-btn" disabled={!dirty} onClick={() => void save()}>
          {saved ? `✓ ${t('common.saved')}` : t('common.save')}
        </button>
      </div>

      <div className="settings-tabs" role="tablist" aria-label={t('settings.sections')}>
        <button
          role="tab"
          aria-selected={tab === 'general'}
          className={`settings-tab ${tab === 'general' ? 'on' : ''}`}
          onClick={() => setTab('general')}
        >
          <span className="tab-ico">⚙</span>
          {t('settings.tab.general')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'types'}
          className={`settings-tab ${tab === 'types' ? 'on' : ''}`}
          onClick={() => setTab('types')}
        >
          <span className="tab-ico">▤</span>
          {t('settings.tab.types')}
          {customTypes.length > 0 && <span className="tab-count">{customTypes.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'plugins'}
          className={`settings-tab ${tab === 'plugins' ? 'on' : ''}`}
          onClick={() => setTab('plugins')}
        >
          <span className="tab-ico">🔌</span>
          {t('settings.tab.plugins')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'ai'}
          className={`settings-tab ${tab === 'ai' ? 'on' : ''}`}
          onClick={() => setTab('ai')}
        >
          <span className="tab-ico">✦</span>
          {t('settings.tab.ai')}
        </button>
      </div>

      {tab === 'general' && (
        <>
          <section className="settings-section">
            <h4>{t('settings.appearance.title')}</h4>
            <label>
              {t('settings.theme')} <span className="muted">{t('settings.appearance.language.hint')}</span>
              <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as 'light' | 'dark' })}>
                <option value="light">{t('settings.theme.light')}</option>
                <option value="dark">{t('settings.theme.dark')}</option>
              </select>
            </label>
            <label>
              {t('settings.appearance.language')} <span className="muted">{t('settings.appearance.language.hint')}</span>
              <select
                value={draft.uiLanguage}
                onChange={(e) => {
                  // The language the app's own text is shown in. It never
                  // reaches a prompt: the agent's output language is its own.
                  const next = e.target.value
                  if (isLanguage(next)) update({ uiLanguage: next })
                }}
              >
                {/* Each language is named in its own script, so a user who
                    cannot read the current interface can still find theirs. */}
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <div className="ai-status-card">
            {snapshot?.aiConfigured ? (
              <span className="ai-on">
                {t('settings.ai.configured', { provider: draft.provider, model: draft.model || t('settings.ai.noModel') })}
              </span>
            ) : (
              <span className="ai-off">{t('settings.ai.notConfigured')}</span>
            )}
          </div>
        </>
      )}

      {tab === 'types' && (
        <>
          {typeError && <div className="warning-box"><p>{typeError}</p><button className="mini-btn" onClick={() => setTypeError(null)}>×</button></div>}
          <section className="settings-section">
            <div className="section-head">
              <h4>{t('settings.types.builtin.title')}</h4>
              <span className="muted">{t('settings.types.builtin.hint')}</span>
            </div>
            <div className="type-card-grid">
              {builtinTypes.map((c) => (
                <div key={c.key} className="type-card builtin">
                  <div className="tc-emoji">{c.emoji}</div>
                  <div className="tc-main">
                    <div className="tc-label">{displayTypeLabel(c, language)}</div>
                    <code className="tc-key">{c.key} · {c.kind}</code>
                    {c.description && <div className="tc-desc">{displayTypeDescription(c, language)}</div>}
                  </div>
                  <div className="tc-actions">
                    <button className="icon-btn tiny" title={t('settings.types.editPresentation')} onClick={() => setTypeEditor({ mode: 'edit', existing: c })}>
                      ✎
                    </button>
                    <span className="tc-badge">{t('palette.type.builtin')}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="section-head">
              <h4>{t('settings.types.custom.title')}</h4>
              <button className="mini-btn primary" onClick={() => setTypeEditor({ mode: 'add' })}>
                ＋ {t('settings.types.new')}
              </button>
            </div>
            {customTypes.length === 0 ? (
              <div className="type-empty">
                <div className="te-emoji">📦</div>
                <div className="te-msg">{t('settings.types.empty.title')}</div>
                <div className="te-sub">{t('settings.types.empty.body')}</div>
              </div>
            ) : (
              <div className="type-card-grid">
                {customTypes.map((c) => (
                  <div key={c.key} className="type-card">
                    <div className="tc-emoji">{c.emoji}</div>
                    <div className="tc-main">
                      <div className="tc-label">{displayTypeLabel(c, language)}</div>
                      <code className="tc-key">{c.key} · {c.kind}</code>
                      {c.description && <div className="tc-desc">{displayTypeDescription(c, language)}</div>}
                    </div>
                    <div className="tc-actions">
                      <button className="icon-btn tiny" title={t('common.edit')} onClick={() => setTypeEditor({ mode: 'edit', existing: c })}>
                        ✎
                      </button>
                      <button className="icon-btn tiny danger" title={t('common.delete')} onClick={() => setPendingDelete(c)}>
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
              <p>{t('settings.plugins.saveFailed', { error: saveError })}</p>
              <button className="mini-btn" onClick={() => setSaveError(null)}>×</button>
            </div>
          )}
          <div className="inert-banner muted">{t('settings.plugins.inert')}</div>

          <SkillsSection
            skills={draft.skills ?? []}
            onChange={(skills) => update({ skills })}
            confirmRemove={async (name) =>
              confirm({
                title: t('settings.plugins.removeSkill.title'),
                message: t('settings.plugins.removeSkill.message', { name }),
                confirmLabel: t('common.remove'),
                danger: true
              })
            }
          />
          <McpSection
            servers={draft.mcpServers ?? []}
            onChange={(mcpServers) => update({ mcpServers })}
            confirmRemove={async (name) =>
              confirm({
                title: t('settings.plugins.removeServer.title'),
                message: t('settings.plugins.removeServer.message', { name }),
                confirmLabel: t('common.remove'),
                danger: true
              })
            }
          />
        </>
      )}

      {tab === 'ai' && (
        <>
          <section className="settings-section">
            <h4>{t('settings.ai.title')}</h4>
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
              {t('settings.ai.apiKey')} <span className="muted">{t('settings.ai.apiKey.hint')}</span>
              <input
                type="password"
                value={draft.apiKey ?? ''}
                onChange={(e) => update({ apiKey: e.target.value || null })}
                placeholder="sk-…"
              />
            </label>
            <div className="row">
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

// Skills management (spec skills-mcp-settings): a skill is a folder containing
// SKILL.md. Importing copies the folder into the app's skills dir and records
// its name/description/path. Entries persist with settings; inert in this
// version (see src/main/plugins.ts + src/main/skills.ts).
function SkillsSection({
  skills,
  onChange,
  confirmRemove
}: {
  skills: SkillEntry[]
  onChange: (next: SkillEntry[]) => void
  confirmRemove: (name: string) => Promise<boolean>
}) {
  const t = useT()
  const [importing, setImporting] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [githubImporting, setGithubImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Both import paths end here: one duplicate check, one append, no drift
  // between the folder import and the GitHub import.
  const addEntry = (entry: SkillEntry) => {
    if (skills.some((s) => s.name === entry.name)) {
      setError(t('settings.skills.exists', { name: entry.name }))
      return
    }
    onChange([...skills, entry])
  }

  const handleImport = async () => {
    setImporting(true)
    setError(null)
    try {
      const entry = await window.api.importSkill()
      if (!entry) return
      addEntry(entry)
    } catch (e: any) {
      setError(e?.message ?? t('settings.skills.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const handleGitHubImport = async () => {
    const url = githubUrl.trim()
    if (!url) return
    setGithubImporting(true)
    setError(null)
    try {
      addEntry(await window.api.importSkillFromGitHub(url))
      setGithubUrl('')
    } catch (e: any) {
      // The refusal arrives already phrased in the user's language — main
      // localizes the codes before they cross IPC.
      setError(e?.message ?? t('settings.skills.githubImportFailed'))
    } finally {
      setGithubImporting(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <h4>{t('settings.skills.title')}</h4>
        <span className="muted">{t('settings.skills.hint')}</span>
      </div>
      {skills.map((s) => (
        <div key={s.name} className="plugin-row">
          <input value={s.name} disabled title={t('settings.skills.nameKey')} className="plugin-name" />
          <input value={s.description} disabled placeholder={t('settings.skills.noDescription')} />
          <button
            className="icon-btn tiny danger"
            title={t('common.remove')}
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
      {skills.length === 0 && (
        <div className="type-empty">
          <div className="te-msg">{t('settings.skills.empty')}</div>
          <div className="te-sub">{t('settings.skills.emptyBody')}</div>
        </div>
      )}
      <div className="plugin-row">
        <button className="mini-btn primary" disabled={importing} onClick={() => void handleImport()}>
          {importing ? t('settings.skills.importing') : `＋ ${t('settings.skills.import')}`}
        </button>
      </div>
      {/* The second import path: a GitHub repository (or a folder inside one).
          The download, the archive safety checks and the SKILL.md contract all
          live in main; this row only hands over the URL. */}
      <div className="plugin-row">
        <input
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleGitHubImport()
          }}
          placeholder={t('settings.skills.githubPlaceholder')}
          spellCheck={false}
          disabled={githubImporting}
        />
        <button
          className="mini-btn primary"
          disabled={githubImporting || !githubUrl.trim()}
          onClick={() => void handleGitHubImport()}
        >
          {githubImporting ? t('settings.skills.importing') : `＋ ${t('settings.skills.githubImport')}`}
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

// MCP server management (add-mcp-support): servers are added MANUALLY by
// pasting the standard mcp.json shape — the app's own row form could not carry
// enough information to make a server work (env was uneditable, remote servers
// impossible). The paste accepts a complete {"mcpServers": {…}} block or a
// { "<name>": {…} } map; the core parser decides, main re-validates on save.
// Saved servers are connected to the interactive sessions of types that grant
// them, and auto-written to the app's mcp.json as an inspection copy.
function McpSection({
  servers,
  onChange,
  confirmRemove
}: {
  servers: McpServerEntry[]
  onChange: (next: McpServerEntry[]) => void
  confirmRemove: (name: string) => Promise<boolean>
}) {
  const t = useT()
  const [paste, setPaste] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const raw = paste.trim()
    if (!raw) return setError(t('settings.mcp.emptyPaste'))
    const { entries, issues } = parseMcpJsonPaste(raw)
    if (issues.length > 0) return setError(issues.map((i) => t(i.key, i.params)).join('\n'))
    const clash = entries.find((e) => servers.some((s) => s.name === e.name))
    // Adding never silently replaces — the user removes the old entry first.
    if (clash) return setError(t('settings.mcp.exists', { name: clash.name }))
    onChange([...servers, ...entries])
    setPaste('')
    setError(null)
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <h4>{t('settings.mcp.title')}</h4>
        <span className="muted">{t('settings.mcp.hint')}</span>
      </div>
      {servers.map((s) => (
        <div key={s.name} className="plugin-row">
          <input value={s.name} disabled title={t('settings.skills.nameKey')} className="plugin-name" />
          <input value={describeMcpServer(s)} disabled />
          <button
            className="icon-btn tiny danger"
            title={t('common.remove')}
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
      {servers.length === 0 && <div className="type-empty"><div className="te-msg">{t('settings.mcp.empty')}</div></div>}
      <textarea
        className="mcp-paste"
        rows={4}
        spellCheck={false}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder={t('settings.mcp.pastePlaceholder')}
      />
      <div className="plugin-row">
        <button className="mini-btn primary" disabled={!paste.trim()} onClick={add}>
          ＋ {t('settings.mcp.addJson')}
        </button>
      </div>
      <div className="muted mcp-note">{t('settings.mcp.mcpJsonNote')}</div>
      <div className="muted mcp-note">{t('settings.mcp.trustNote')}</div>
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
  const { snapshot, types } = useApp()
  const t = useT()
  const language = useLanguage()
  const isBuiltinEdit = mode === 'edit' && !!existing?.isBuiltin
  const [key, setKey] = useState(existing?.key ?? '')
  const [kind, setKind] = useState<TaskKind>(existing?.kind ?? 'learning')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📌')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [aiGuidance, setAiGuidance] = useState(existing?.aiGuidance ?? '')
  // The declared workflow. A built-in's behaviour is immutable (FR-017), so
  // for those the value is displayed rather than chosen.
  const [finishBehaviour, setFinishBehaviour] = useState<FinishBehaviour>(
    existing?.finishBehaviour ?? DEFAULT_FINISH_BEHAVIOUR
  )
  const [destStore, setDestStore] = useState<DestinationStore>(existing?.destination?.store ?? 'folder')
  const [destRoot, setDestRoot] = useState(existing?.destination?.rootPath ?? '')
  const [destSubdir, setDestSubdir] = useState(existing?.destination?.subdir ?? '')
  const [grantSkills, setGrantSkills] = useState<Set<string>>(new Set(existing?.grants?.skills ?? []))
  const [grantServers, setGrantServers] = useState<Set<string>>(new Set(existing?.grants?.toolServers ?? []))
  // The fields offered come from the kind's built-in type, and their labels are
  // seeded strings — shown in the active language through the same rule as
  // everywhere else.
  const kindDef = allTypeConfigs(types).find((c) => c.key === kind)
  const supported = kindDef ? localizeTypeDef(kindDef, language).inputSchema : kindSchema(kind)
  const behaviourWrites = (existing?.isBuiltin ? existing.finishBehaviour : finishBehaviour) !== 'complete-only'
  const skillsForGrants = snapshot?.settings.skills ?? []
  const serversForGrants = snapshot?.settings.mcpServers ?? []
  const [fieldKeys, setFieldKeys] = useState<Set<string>>(
    new Set(existing && !existing.isBuiltin ? existing.inputSchema.map((f) => f.key) : supported.map((f) => f.key))
  )
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const k = key.trim().replace(/\s+/g, '_').toLowerCase()
    if (!existing) {
      if (!k) return setError(t('typeEditor.keyRequired'))
      if (!/^[a-z0-9_]{2,32}$/.test(k)) return setError(t('typeEditor.keyFormat'))
      if (takenKeys.has(k)) return setError(t('typeEditor.keyTaken', { key: k }))
    }
    if (!label.trim()) return setError(t('typeEditor.labelRequired'))
    if (!emoji.trim()) return setError(t('typeEditor.emojiRequired'))
    const inputSchema = existing?.isBuiltin ? existing.inputSchema : supported.filter((f) => fieldKeys.has(f.key))

    // A built-in's behaviour is fixed; its destination is a setting the user
    // owns (FR-004) and stays editable. BOTH stores declare their own root
    // now — there is no global wiki location to inherit. A folder without a
    // root means nothing, so it is caught here; a wiki may be saved before it
    // is pointed (the seeded Learning type starts that way) — Finish refuses
    // until it names a directory.
    const behaviour = existing?.isBuiltin ? existing.finishBehaviour : finishBehaviour
    const writes = behaviour !== 'complete-only'
    if (writes && destStore === 'folder' && !destRoot.trim()) {
      return setError(t('typeEditor.needsFolder'))
    }
    if (writes && destSubdir.trim().split(/[\\/]/).includes('..')) {
      return setError(t('typeEditor.subfolderRelative'))
    }
    const destination: Destination | undefined = writes
      ? { store: destStore, rootPath: destRoot.trim() || null, subdir: destSubdir.trim() }
      : undefined

    void onSave({
      key: existing?.key ?? k,
      kind: existing?.isBuiltin ? existing.kind : kind,
      label: label.trim(),
      emoji: emoji.trim().slice(0, 4),
      description: description.trim() || undefined,
      inputSchema,
      aiGuidance: (!existing?.isBuiltin && aiGuidance.trim()) || undefined,
      isBuiltin: existing?.isBuiltin ?? false,
      finishBehaviour: behaviour,
      destination,
      grants: { skills: [...grantSkills], toolServers: [...grantServers] }
    })
  }

  const chooseDestFolder = async () => {
    const picked = await window.api.chooseFolder()
    if (picked) setDestRoot(picked)
  }

  const toggleGrant = (setter: (fn: (cur: Set<string>) => Set<string>) => void) => (name: string) =>
    setter((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

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
          <span className="modal-tag">{mode === 'add' ? `＋ ${t('typeEditor.newTag')}` : `✎ ${t('typeEditor.editTag')}`}</span>
          <h3>{mode === 'add' ? t('typeEditor.newTitle') : existing?.isBuiltin ? t('typeEditor.editBuiltin') : t('typeEditor.editTitle')}</h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              {t('typeEditor.key')}
              <input value={key} disabled={mode === 'edit'} onChange={(e) => setKey(e.target.value)} placeholder={t('typeEditor.keyPlaceholder')} spellCheck={false} />
            </label>
            <label style={{ width: 80 }}>
              {t('typeEditor.emoji')}
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
            </label>
          </div>
          <label>
            {t('typeEditor.label')}
            <input autoFocus={mode === 'add'} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('typeEditor.labelPlaceholder')} />
          </label>
          <label>
            {t('typeEditor.description')}
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('typeEditor.descriptionPlaceholder')} />
          </label>
          {!isBuiltinEdit && (
            <>
              <label>
                {t('typeEditor.kind')}
                <select value={kind} disabled={mode === 'edit'} onChange={(e) => setKind(e.target.value as TaskKind)}>
                  <option value="plain">{t('typeEditor.kind.plain')}</option>
                  <option value="learning">{t('typeEditor.kind.learning')}</option>
                  <option value="jira">{t('typeEditor.kind.jira')}</option>
                  <option value="meeting">{t('typeEditor.kind.meeting')}</option>
                </select>
              </label>
              {mode === 'add' && (
                <div className="tif-fields">
                  <span className="tif-label">{t('typeEditor.fields')}</span>
                  {supported.map((f) => (
                    <label key={f.key} className="tif-check">
                      <input type="checkbox" checked={fieldKeys.has(f.key)} onChange={() => toggleField(f.key)} />
                      {f.label}
                      {f.required && <span className="tif-required"> *</span>}
                      {f.inert && <span className="muted"> {t('task.inputs.notYetActive')}</span>}
                    </label>
                  ))}
                </div>
              )}
              <label>
                {t('typeEditor.aiGuidance')} <span className="muted">{t('typeEditor.aiGuidanceHint')}</span>
                <textarea value={aiGuidance} onChange={(e) => setAiGuidance(e.target.value)} rows={3} placeholder={t('typeEditor.aiGuidancePlaceholder')} />
              </label>
            </>
          )}

          {/* ---- Declared finish behaviour and destination (FR-002, FR-014) ---- */}
          <div className="tif-fields">
            <span className="tif-label">{t('typeEditor.finishBehaviour')}</span>
            {existing?.isBuiltin ? (
              <div className="muted">
                {t(FINISH_BEHAVIOUR_LABELS[existing.finishBehaviour])} — {t('typeEditor.finishFixed')}
              </div>
            ) : (
              <>
                <select value={finishBehaviour} onChange={(e) => setFinishBehaviour(e.target.value as FinishBehaviour)}>
                  {FINISH_BEHAVIOURS.map((b) => (
                    <option key={b} value={b}>
                      {t(FINISH_BEHAVIOUR_LABELS[b])}
                    </option>
                  ))}
                </select>
                <span className="muted">{t('typeEditor.finishHint')}</span>
              </>
            )}
          </div>

          {behaviourWrites && (
            <div className="tif-fields">
              <span className="tif-label">{t('typeEditor.destination')}</span>
              <select value={destStore} onChange={(e) => setDestStore(e.target.value as DestinationStore)}>
                <option value="folder">{t('typeEditor.dest.folder')}</option>
                <option value="wiki">{t('typeEditor.dest.wiki')}</option>
              </select>
              {/* Both stores own their root — the wiki's directory is declared
                  here, on the type, not in a global setting. The picker, the
                  input and the subfolder behave identically; only what the
                  store DOES on first write differs. */}
              <div className="row" style={{ gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  value={destRoot}
                  onChange={(e) => setDestRoot(e.target.value)}
                  placeholder="/path/to/your/folder"
                  spellCheck={false}
                />
                <button type="button" className="secondary-btn" onClick={() => void chooseDestFolder()}>
                  {t('common.choose')}
                </button>
              </div>
              <label>
                {t('typeEditor.subfolder')} <span className="muted">{t('typeEditor.subfolderHint')}</span>
                <input value={destSubdir} onChange={(e) => setDestSubdir(e.target.value)} placeholder="e.g. minutes/2026" spellCheck={false} />
              </label>
              {destStore === 'folder' ? (
                <span className="muted">{t('typeEditor.folderHint')}</span>
              ) : (
                <span className="muted">
                  {t('typeEditor.wikiResolved', {
                    dest: describeDestination({
                      store: 'wiki',
                      rootPath: destRoot.trim() || null,
                      subdir: destSubdir.trim()
                    })
                  })}
                </span>
              )}
            </div>
          )}

          {/* ---- Grants (FR-019; contracts/plugin-grants.md §6) ---- */}
          <div className="tif-fields">
            <span className="tif-label">{t('typeEditor.capabilities')}</span>
            <span className="muted">{t('typeEditor.capabilitiesHint')}</span>
            <div className="tif-check-group">
              <span className="muted">{t('typeEditor.skillsLabel')}</span>
              {(skillsForGrants.length === 0 && <span className="muted">{t('typeEditor.noneImported')}</span>) || null}
              {skillsForGrants.map((sk: SkillEntry) => (
                <label key={`skill-${sk.name}`} className="tif-check">
                  <input type="checkbox" checked={grantSkills.has(sk.name)} onChange={() => toggleGrant(setGrantSkills)(sk.name)} />
                  {sk.name}
                </label>
              ))}
            </div>
            <div className="tif-check-group">
              <span className="muted">{t('typeEditor.serversLabel')}</span>
              {(serversForGrants.length === 0 && <span className="muted">{t('typeEditor.noneRegistered')}</span>) || null}
              {serversForGrants.map((sv: McpServerEntry) => (
                <label key={`server-${sv.name}`} className="tif-check">
                  <input type="checkbox" checked={grantServers.has(sv.name)} onChange={() => toggleGrant(setGrantServers)(sv.name)} />
                  {sv.name} <span className="muted">{t('typeEditor.grantReach')}</span>
                </label>
              ))}
            </div>
            {(grantServers.size > 0 || grantSkills.size > 0) && (
              <span className="muted">{t('typeEditor.grantHint')}</span>
            )}
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary-btn" onClick={submit}>
            {mode === 'add' ? t('common.create') : t('common.save')}
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
  const t = useT()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag danger">🗑 {t('typeEditor.deleteTag')}</span>
          <h3>{t('typeEditor.deleteTitle', { label: config.label })}</h3>
        </div>
        <div className="modal-body">
          <p>{refCount > 0 ? t('typeEditor.deleteInUse', { count: refCount }) : t('typeEditor.deleteUnused')}</p>
          <p className="muted">{t('typeEditor.deleteHint')}</p>
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="danger-btn" onClick={onConfirm}>
            {t('typeEditor.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
