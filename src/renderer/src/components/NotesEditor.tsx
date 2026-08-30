import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

export function NotesEditor({ taskId, initial, onSave }: { taskId: string; initial: string; onSave: (taskId: string, content: string) => Promise<void> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ taskId: string; content: string } | null>(null)
  const dirtyRef = useRef(false)
  const [preview, setPreview] = useState(false)
  const [html, setHtml] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Debounced autosave (design D7): writes only after ~500ms of quiet, plus
  // a flush on blur/unmount so nothing is lost on task switch or app close.
  const flushSave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current || !pendingRef.current) return
    const { taskId: tid, content } = pendingRef.current
    dirtyRef.current = false
    void onSave(tid, content)
    setSavedAt(new Date().toLocaleTimeString())
  }

  useEffect(() => {
    if (!containerRef.current) return
    const scheduleSave = (content: string) => {
      pendingRef.current = { taskId, content }
      dirtyRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flushSave, 500)
    }
    const view = new EditorView({
      doc: initial,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setHtml(md.render(update.state.doc.toString()))
            scheduleSave(update.state.doc.toString())
          }
        })
      ],
      parent: containerRef.current
    })
    viewRef.current = view
    setHtml(md.render(initial))
    view.dom.addEventListener('blur', flushSave)
    return () => {
      flushSave()
      view.destroy()
      viewRef.current = null
    }
  }, [taskId])

  return (
    <div className="notes-editor">
      <div className="editor-toolbar">
        <button className={`mini-btn ${!preview ? 'active' : ''}`} onClick={() => setPreview(false)}>
          Write
        </button>
        <button className={`mini-btn ${preview ? 'active' : ''}`} onClick={() => setPreview(true)}>
          Preview
        </button>
        {savedAt && <span className="muted">saved {savedAt}</span>}
      </div>
      {preview ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /> : <div ref={containerRef} className="cm-editor-host" />}
    </div>
  )
}
