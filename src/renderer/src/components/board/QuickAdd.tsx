import { useState } from 'react'
import { useApp } from '../../store'
import { allTypeConfigs } from '../../lib/typeCatalog'

// Inline quick capture (spec task-capture): Enter creates the task in the
// given list. The id="quick-add" is the focus target for the global 'n' /
// Ctrl+N shortcut handled in App.tsx.
//
// Right-side chips pin the next task's type — the pinned type applies to
// captures until unpinned. Quick capture fills only shared fields; type
// inputs are completed later from the focus band (or the New-task modal).
export function QuickAdd({ listId, onCreated }: { listId: string; onCreated?: () => void }) {
  const { snapshot, types, createTask } = useApp()
  const [value, setValue] = useState('')
  // Pinned key: any type key from the registry, or null → plain.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)

  const configs = allTypeConfigs(types)

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    const def = configs.find((c) => c.key === (pinnedKey ?? 'plain')) ?? configs[0]!
    await createTask({
      listId,
      title: v,
      type: def.isBuiltin ? (def.key as 'plain' | 'learning' | 'jira') : 'plain',
      customTypeKey: def.isBuiltin ? null : def.key
    })
    setValue('')
    onCreated?.()
    // The pin stays sticky for follow-up captures in the same session.
  }

  const effectiveKey = pinnedKey ?? 'plain'

  return (
    <form
      id="quick-add"
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <span className="qa-plus">＋</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What needs doing?"
        aria-label="Quick add task"
        autoComplete="off"
      />
      <div className="qa-type-switch" role="radiogroup" aria-label="Type for next task">
        {configs.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`qa-type-chip ${effectiveKey === c.key ? 'sel' : ''}`}
            role="radio"
            aria-checked={effectiveKey === c.key}
            title={c.description ?? c.label}
            onClick={() => setPinnedKey(pinnedKey === c.key ? null : c.key)}
          >
            <span className="qa-ico">{c.emoji}</span>
            <span className="qa-label">{c.label.replace(/\s.*$/, '')}</span>
          </button>
        ))}
      </div>
    </form>
  )
}
