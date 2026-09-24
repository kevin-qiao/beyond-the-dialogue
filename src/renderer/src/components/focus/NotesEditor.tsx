import { useEffect, useRef, useState } from 'react'
import { useLocale, useT } from '../../lib/useT'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

type Tab = 'write' | 'preview'

// The working-area tab shell: Write (the CodeMirror editor) and Preview (that
// document rendered). The two are peers sharing one body, so the section fills
// the column and only the active tab is displayed. (Chat used to be this
// shell's third tab; it now lives in the band above, see FocusColumn.)
//
// The editor host is NEVER unmounted while another tab is active — it is
// hidden with CSS. Rebuilding the CodeMirror view on every tab switch would
// discard the cursor, the undo history and the scroll position, and the
// autosave debounce lives in that view.
export function NotesEditor({
  taskId,
  initial,
  onSave
}: {
  taskId: string
  initial: string
  onSave: (taskId: string, content: string) => Promise<void>
}) {
  const t = useT()
  const locale = useLocale()
  // Read through a ref inside flushSave: the editor effect must not depend on
  // the locale, or switching language would rebuild the CodeMirror view and
  // discard the cursor, the undo history and the scroll position.
  const localeRef = useRef(locale)
  localeRef.current = locale
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ taskId: string; content: string } | null>(null)
  const dirtyRef = useRef(false)
  const [tab, setTab] = useState<Tab>('write')
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
    setSavedAt(new Date().toLocaleTimeString(localeRef.current))
  }

  useEffect(() => {
    if (!containerRef.current) return
    // Back to Write on a task switch: the view is rebuilt here, and it must be
    // visible while it measures itself.
    setTab('write')
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

  // Preview reads the live document, so it is rendered on entry rather than
  // kept in sync on every keystroke.
  const openPreview = () => {
    setHtml(md.render(viewRef.current?.state.doc.toString() ?? ''))
    setTab('preview')
  }

  return (
    <div className="notes-editor">
      <div className="editor-toolbar">
        <button className={`mini-btn ${tab === 'write' ? 'active' : ''}`} onClick={() => setTab('write')}>
          {t('editor.write')}
        </button>
        <button className={`mini-btn ${tab === 'preview' ? 'active' : ''}`} onClick={openPreview}>
          {t('editor.preview')}
        </button>
        {savedAt && <span className="muted">{t('editor.saved', { when: savedAt })}</span>}
      </div>
      {/* The editor host stays mounted (hidden via CSS) so the CodeMirror view
          survives Write→Preview→Write; Preview is its sibling. */}
      <div ref={containerRef} className="cm-editor-host" style={{ display: tab === 'write' ? '' : 'none' }} />
      {tab === 'preview' && <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
