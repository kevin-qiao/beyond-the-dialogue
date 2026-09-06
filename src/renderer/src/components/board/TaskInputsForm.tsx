import type { Settings, TaskTypeDef, TypeInputField } from '../../../../shared/types'

// Generic per-type inputs form (design D1/D2): renders the fields declared by
// a type's inputSchema and writes string values into `inputs`. The task form
// (creation) and the AI band (editing) share this renderer, so new types add
// no UI code. Inert fields (skill/MCP placeholders in v0.8) are stored but
// labeled "not yet active" (spec learning-type / jira-confluence-type).

function optionsFor(field: TypeInputField, settings?: Pick<Settings, 'skills' | 'mcpServers'> | null): { value: string; label: string }[] {
  if (field.options) return field.options
  if (field.optionsSource === 'skills') return (settings?.skills ?? []).map((s) => ({ value: s.name, label: s.name }))
  if (field.optionsSource === 'mcpServers') return (settings?.mcpServers ?? []).map((s) => ({ value: s.name, label: s.name }))
  return []
}

export function TaskInputsForm({
  def,
  values,
  onChange,
  settings,
  lockedKeys = []
}: {
  def: TaskTypeDef
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  settings?: Pick<Settings, 'skills' | 'mcpServers'> | null
  // Field keys that cannot be changed after creation (immutable, e.g. jira
  // sourceKind) once they carry a value.
  lockedKeys?: string[]
}) {
  const visible = def.inputSchema.filter((f) => !f.hidden)
  if (visible.length === 0) return null

  const set = (key: string, v: string) => onChange({ ...values, [key]: v })
  const val = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : '')

  return (
    <div className="task-inputs">
      {visible.map((field) => {
        const locked = lockedKeys.includes(field.key) || (field.immutable && val(field.key) !== '')
        const opts = optionsFor(field, settings)
        return (
          <label key={field.key} className={`tif-field tif-${field.type}`}>
            <span className="tif-label">
              {field.label}
              {field.required && <span className="tif-required"> *</span>}
              {field.inert && <span className="tif-inert muted"> (not yet active)</span>}
            </span>
            {field.type === 'textarea' ? (
              <textarea
                value={val(field.key)}
                rows={4}
                disabled={locked}
                placeholder={field.placeholder ?? ''}
                onChange={(e) => set(field.key, e.target.value)}
              />
            ) : field.type === 'select' ? (
              <select value={val(field.key)} disabled={locked} onChange={(e) => set(field.key, e.target.value)}>
                <option value="">—</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'file' ? (
              <span className="tif-file-row">
                <input value={val(field.key)} disabled={locked} accept=".md,.markdown" placeholder={field.placeholder ?? ''} onChange={(e) => set(field.key, e.target.value)} />
                <button
                  type="button"
                  className="mini-btn"
                  disabled={locked}
                  onClick={() => void window.api.chooseFile().then((p) => p && set(field.key, p))}
                >
                  Choose…
                </button>
              </span>
            ) : (
              <input
                value={val(field.key)}
                disabled={locked}
                placeholder={field.placeholder ?? ''}
                type={field.type === 'url' ? 'url' : 'text'}
                onChange={(e) => set(field.key, e.target.value)}
              />
            )}
          </label>
        )
      })}
    </div>
  )
}
