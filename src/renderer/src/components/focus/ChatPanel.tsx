import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'

// Reusable chat loop (design D4): the streaming conversation surface shared
// by the debug ChatView drawer and the learning/jira working areas. When
// mounted with a taskId, the main process grounds replies in that task's
// context (inputs, pre-process outputs, current note). The conversation is
// per-surface — mounting a panel for a different surface starts fresh.
export function ChatPanel({ taskId, label = 'Ask the agent anything' }: { taskId?: string; label?: string }) {
  const { chatMessages, chatStreaming, chatRunning, chatError, sendChat, notify } = useApp()
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
      await sendChat(text, taskId)
    } catch {
      notify('Failed to reach the model — see the error above')
    }
  }

  const streaming = chatStreaming ?? ''

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {chatMessages.length === 0 && !chatStreaming && <div className="empty-hint">{label}</div>}
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
          placeholder={chatRunning ? 'The model is replying…' : 'Message the agent… (Enter to send)'}
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
