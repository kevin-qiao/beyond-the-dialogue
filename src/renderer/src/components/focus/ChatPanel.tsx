import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'
import { useLocale, useT } from '../../lib/useT'
import { isAssistantEnabled } from '../../../../core/domain/assistant'
import { isConfigured } from '../../../../core/domain/config'
import type { Conversation, ConversationMessage } from '../../../../shared/types'

// The task-owned conversation surface (feature 002, US2): stored
// conversations listed with the task, the selected one rendered in insertion
// order, a "new conversation" action, and a send that streams its reply.
//
// The transcript is STORAGE, not memory (FR-009): reopening the task — or
// restarting the app — presents the conversations again, in order. Deltas
// stream against their conversation id and the stored message then arrives
// through conversation.updated, so no delta is ever shown without the stored
// message behind it (contract Events).
//
// This surface renders for ANY task (FR-008), whatever its Type or family.
// While the assistant is off or unconfigured it states plainly why it is
// unavailable (US2-AC3) — and the rest of the board is unaffected.
export function ChatPanel({ taskId }: { taskId: string }) {
  const { snapshot } = useApp()
  const t = useT()
  const locale = useLocale()
  const settings = snapshot?.settings
  const assistantOn = !!settings && isAssistantEnabled(settings)
  const configured = !!settings && isConfigured(settings)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // Load the task's conversations on (re)selection; the newest is opened.
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setActiveId(null)
    setStreaming(null)
    setError(null)
    setBusy(false)
    void window.api.conversationsList({ taskId }).then(async (convs) => {
      if (cancelled) return
      setConversations(convs)
      if (convs.length > 0) {
        setActiveId(convs[0]!.id)
        setMessages(await window.api.conversationsMessages({ conversationId: convs[0]!.id }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [taskId])

  // Live events for the open conversation: deltas stream in; each stored
  // message appends (deduped by id — the send result and the event race).
  useEffect(() => {
    const offDelta = window.api.onConversationDelta((e) => {
      if (e.conversationId !== activeId) return
      setStreaming((cur) => (cur ?? '') + e.delta)
    })
    const offUpdated = window.api.onConversationUpdated((e) => {
      if (e.conversationId === activeId) {
        setMessages((cur) => (cur.some((m) => m.id === e.message.id) ? cur : [...cur, e.message]))
        if (e.message.role === 'assistant') {
          setStreaming(null)
          setBusy(false)
        }
      }
      setConversations((cur) =>
        cur.map((c) => (c.id === e.conversationId ? { ...c, messageCount: (c.messageCount ?? 0) + 1 } : c))
      )
    })
    return () => {
      offDelta()
      offUpdated()
    }
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, streaming])

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setStreaming(null)
    setError(null)
    setMessages(await window.api.conversationsMessages({ conversationId: id }))
  }, [])

  const startNew = useCallback(async () => {
    const conv = await window.api.conversationsCreate({ taskId })
    // Earlier conversations remain retrievable (US2-AC4); the fresh one opens
    // empty.
    setConversations((cur) => [conv, ...cur])
    setActiveId(conv.id)
    setMessages([])
    setStreaming(null)
    setError(null)
  }, [taskId])

  const removeConversation = useCallback(
    async (id: string) => {
      await window.api.conversationsDelete({ conversationId: id })
      setConversations((cur) => {
        const next = cur.filter((c) => c.id !== id)
        if (id === activeId) {
          const fallback = next[0] ?? null
          setActiveId(fallback ? fallback.id : null)
          if (fallback) void window.api.conversationsMessages({ conversationId: fallback.id }).then(setMessages)
          else setMessages([])
        }
        return next
      })
    },
    [activeId]
  )

  const submit = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setError(null)
    setStreaming(null)
    setBusy(true)
    let convId = activeId
    try {
      if (!convId) {
        const conv = await window.api.conversationsCreate({ taskId })
        setConversations((cur) => [conv, ...cur])
        setActiveId(conv.id)
        convId = conv.id
      }
      // The user turn is stored main-side BEFORE the call and announced
      // through conversation.updated; the reply streams as deltas and lands
      // as its own stored message. The optimistic view is the streaming slot.
      const res = await window.api.conversationsSend({ conversationId: convId, content: text })
      if (!res.ok) {
        setError(res.error ?? t('chat.sendFailed'))
      }
    } catch (e: any) {
      setError(e?.message ?? t('error.mainUnreachable'))
    } finally {
      setBusy(false)
      setStreaming(null)
    }
  }

  // US2-AC3: the unavailable state is stated plainly, with the reason — the
  // history (the user's own record) stays readable, and the board is
  // unaffected either way.
  const unavailableReason = !assistantOn
    ? t('conversation.unavailable.off')
    : !configured
      ? t('conversation.unavailable.notConfigured')
      : null

  return (
    <div className="chat-panel">
      <div className="chat-conversation-row">
        <span className="tif-label">{t('chat.listLabel')}</span>
        {conversations.map((c, i) => (
          <span key={c.id} className={`chip ${c.id === activeId ? 'active' : ''}`}>
            <button
              className="chip-link"
              onClick={() => void openConversation(c.id)}
              title={new Date(c.createdAt).toLocaleString(locale)}
            >
              {t('chat.conversationLabel', { n: String(conversations.length - i) })}
            </button>
            <button className="chip-x" title={t('chat.delete')} onClick={() => void removeConversation(c.id)}>
              ×
            </button>
          </span>
        ))}
        <button className="mini-btn" onClick={() => void startNew()}>
          ＋ {t('chat.new')}
        </button>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && !streaming && <div className="empty-hint">{t('chat.emptyHint')}</div>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {streaming !== null && (
          <div className="chat-msg assistant streaming">
            {streaming}
            <span className="chat-cursor" />
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && <div className="error-text chat-error">✕ {error}</div>}
      {unavailableReason ? (
        <div className="empty-hint chat-unavailable">{unavailableReason}</div>
      ) : (
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
            placeholder={busy ? t('chat.replying') : t('chat.placeholder')}
            disabled={busy}
            autoComplete="off"
            aria-label={t('chat.placeholder')}
          />
          <button className="primary-btn" type="submit" disabled={busy || !draft.trim()}>
            {t('common.send')}
          </button>
        </form>
      )}
    </div>
  )
}
