import { useState } from 'react'
import { useApp } from '../store'
import { isPaperLink } from '../../../shared/link'

// Inline quick capture (spec task-capture): Enter creates the task in the
// given list; pasting an arXiv/DOI/URL auto-detects a paper-reading task.
// The id="quick-add" is the focus target for the global 'n' / Ctrl+N
// shortcut handled in App.tsx.
export function QuickAdd({ listId, onCreated }: { listId: string; onCreated?: () => void }) {
  const { createTask } = useApp()
  const [value, setValue] = useState('')

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    const paper = isPaperLink(v)
    await createTask({
      listId,
      title: v,
      type: paper ? 'paper_reading' : 'plain',
      link: paper ? v : undefined
    })
    setValue('')
    onCreated?.()
  }

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
    </form>
  )
}
