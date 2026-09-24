import { useState } from 'react'
import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import { IconPlus } from '../ui/icons'

// Inline quick capture (spec task-capture): Enter creates the task in the
// given list. The id="quick-add" is the focus target for the global 'n' /
// Ctrl+N shortcut handled in App.tsx.
//
// Capture is deliberately title-only. The type is not chosen here: a captured
// task is plain, and its type is set where the type's own inputs are — the ✎
// Edit modal (TaskForm) or the focus band's type dropdown. Keeping the type
// out of the capture box keeps it a one-line, always-ready input.
export function QuickAdd({ listId, onCreated }: { listId: string; onCreated?: () => void }) {
  const { createTask } = useApp()
  const t = useT()
  const [value, setValue] = useState('')

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    await createTask({ listId, title: v, type: 'plain' })
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
      <span className="qa-plus">
        <IconPlus />
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('task.capture.placeholder')}
        aria-label={t('task.capture.ariaLabel')}
        autoComplete="off"
      />
    </form>
  )
}
