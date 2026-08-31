import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'

// Debug chat (model connection check): a free-form conversation with the
// configured model. Streams tokens live via ev:chat-delta; history lives in
// main and is lost on restart — this is a debugging surface, not a record.
export function ChatView() {
  const { chatMessages, chatStreaming, chatRunning, chatError, sendChat, resetChat, notify } = useApp()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatStreaming])

  const submit = async () => {
    const text = draft.trim()
    if (!text || chatRunning) return
    setDraft('')
    try {
      await sendChat(text)
    } catch {
      notify('Failed to reach the model — see the error above')
    }
  }

  const streaming = chatStreaming ?? ''

  return (
    <div className="view chat-view">
      <div className="view-head">
        <h2>Chat</h2>
        <div className="row">
          <button className="mini-btn" onClick={() => void resetChat()}>
            New conversation
          </button>
        </div>
      </div>
      <span className="muted chat-sub">Debug: talk to your configured model to verify the connection and model behavior.</span>

      {chatMessages.length === 0 && !chatStreaming && (
        <div className="empty-hint">
          No messages yet. Say hello, or ask the model to describe itself — anything that confirms the provider is reachable.
        </div>
      )}

      <div className="chat-messages">
        {chatMessages.map((m, i) => (
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
          placeholder={chatRunning ? 'The model is replying…' : 'Message the model… (Enter to send)'}
          disabled={chatRunning}
          autoComplete="off"
        />
        <button className="primary-btn" type="submit" disabled={chatRunning || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
