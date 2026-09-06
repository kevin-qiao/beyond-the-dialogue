import { useEffect, useRef } from 'react'

// Right-click context menu for a task row. Presentational: it reports the
// chosen action to the parent (TaskColumn) and closes on outside click or
// Escape. Delete/confirm live in the parent so the dialog stays mounted while
// the menu unmounts.
export function TaskContextMenu({
  x,
  y,
  onEdit,
  onDelete,
  onClose
}: {
  x: number
  y: number
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return (
    <div className="ctx-menu" ref={ref} style={{ top: y, left: x }}>
      <button className="ctx-item" onClick={onEdit}>
        ✎ Edit
      </button>
      <button className="ctx-item danger" onClick={onDelete}>
        🗑 Delete
      </button>
    </div>
  )
}
