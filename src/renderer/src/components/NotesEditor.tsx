import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

export function NotesEditor({ taskId, initial, onSave }: { taskId: string; initial: string; onSave: (taskId: string, content: string) => Promise<void> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [preview, setPreview] = useState(false)
  const [html, setHtml] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      doc: initial,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setHtml(md.render(update.state.doc.toString()))
            void onSave(taskId, update.state.doc.toString())
            setSavedAt(new Date().toLocaleTimeString())
          }
        })
      ],
      parent: containerRef.current
    })
    viewRef.current = view
    setHtml(md.render(initial))
    return () => {
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
