import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'
import { useT } from '../../lib/useT'

// Reusable chat loop (design D4): the streaming conversation surface shared
// by the debug ChatView drawer and the learning/jira working areas. When
// mounted with a taskId, the main process grounds replies in that task's
// context (inputs, pre-process outputs, current note).
//
// The transcript is per-surface and lives in the store keyed by owner, not by
// which panel is mounted: this panel reads and writes only its own task's
// conversation, so switching tasks keeps each conversation intact and a reply
// still streaming for one task never appears in another's.
export function ChatPanel({ taskId, label }: { taskId?: string; label?: string }) {
  const { chatFor, sendChat } = useApp()
  const t = useT()
  const { messages, streaming: chatStreaming, running: chatRunning, error: chatError } = chatFor(taskId)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // A caller that passes an empty label means "show no hint"; one that passes
  // nothing gets the default, translated. A default parameter could not do
  // that — it cannot call a hook.
  const hint = label === undefined ? t('chat.emptyHint') : label

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, chatStreaming])

  const submit = async () => {
    const text = draft.trim()
    if (!text || chatRunning) return
    setDraft('')
    // sendChat records its own failure in the surface's state (shown below),
    // so nothing here needs to report it.
    await sendChat(text, taskId)
  }

  const streaming = chatStreaming ?? ''

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {hint && messages.length === 0 && !chatStreaming && <div className="empty-hint">{hint}</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {chatRunning && (
          <div className="chat-msg assistant streaming">
            {streaming}
            <span className="chat-cursor" />
          </div>
        )}
        <div ref={endRef} />
      </div>
      {chatError && <div className="error-text chat-error">✕ {chatError}</div>}
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          className="search-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={chatRunning ? t('chat.replying') : t('chat.placeholder')}
          disabled={chatRunning}
          autoComplete="off"
        />
        <button className="primary-btn" type="submit" disabled={chatRunning || !draft.trim()}>
          {t('common.send')}
        </button>
      </form>
    </div>
  )
}
