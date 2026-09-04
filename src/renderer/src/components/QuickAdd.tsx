import { useState } from 'react'
import { useApp } from '../store'
import { isPaperLink } from '../../../shared/link'
import { allTypeConfigs } from '../shared/typeCatalog'

// Inline quick capture (spec task-capture): Enter creates the task in the
// given list; pasting an arXiv/DOI/URL auto-detects a paper-reading task.
// The id="quick-add" is the focus target for the global 'n' / Ctrl+N
// shortcut handled in App.tsx.
//
// Right-side chips let the caller pin the next task's type — useful when you
// paste a non-link PDF title or a generic plain task. Built-in paper link
// auto-detection always wins when it matches.
export function QuickAdd({ listId, onCreated }: { listId: string; onCreated?: () => void }) {
  const { createTask, snapshot } = useApp()
  const [value, setValue] = useState('')
  // Pinned key: 'plain', 'paper_reading', or any custom type key.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)

  const configs = allTypeConfigs(snapshot?.settings)

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    const paper = isPaperLink(v)
    // Effective type: paper link forces paper_reading; otherwise the user's
    // pin (which may point at a custom type).
    let builtinType: 'plain' | 'paper_reading'
    let customKey: string | null = null
    if (paper) {
      builtinType = 'paper_reading'
    } else if (pinnedKey && pinnedKey !== 'plain' && pinnedKey !== 'paper_reading') {
      builtinType = 'plain'
      customKey = pinnedKey
    } else if (pinnedKey === 'paper_reading') {
      builtinType = 'paper_reading'
    } else {
      builtinType = 'plain'
    }
    await createTask({
      listId,
      title: v,
      type: builtinType,
      customTypeKey: customKey,
      link: paper ? v : undefined
    })
    setValue('')
    // Keep the pin sticky for follow-up captures in the same session; only a
    // new paste of a paper link promotes to paper_reading automatically.
  }

  const detectedPaper = !!value.trim() && isPaperLink(value)
  const effectiveKey = detectedPaper ? 'paper_reading' : pinnedKey ?? 'plain'

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
        placeholder="What needs doing?  ·  paste an arXiv link → paper task"
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
