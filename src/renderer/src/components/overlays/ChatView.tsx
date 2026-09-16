import { useApp } from '../../store'
import { useT } from '../../lib/useT'
import { ChatPanel } from '../focus/ChatPanel'

// Debug chat drawer (model connection check): a free-form conversation with
// the configured model, ungrounded. Since v0.8 it delegates the streaming
// loop to the shared ChatPanel and remains for inspecting the model.
export function ChatView() {
  const { resetChat } = useApp()
  const t = useT()
  return (
    <div className="view chat-view">
      <div className="view-head">
        <h2>{t('chat.title')}</h2>
        <div className="row">
          <button className="mini-btn" onClick={() => void resetChat()}>
            {t('chat.newConversation')}
          </button>
        </div>
      </div>
      <span className="muted chat-sub">{t('chat.debugIntro')}</span>
      <ChatPanel label={t('chat.debugEmpty')} />
    </div>
  )
}
