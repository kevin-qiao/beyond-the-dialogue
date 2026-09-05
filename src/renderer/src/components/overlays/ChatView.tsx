import { useApp } from '../../store'
import { ChatPanel } from '../focus/ChatPanel'

// Debug chat drawer (model connection check): a free-form conversation with
// the configured model, ungrounded. Since v0.8 it delegates the streaming
// loop to the shared ChatPanel and remains for inspecting the model.
export function ChatView() {
  const { resetChat } = useApp()
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
      <ChatPanel label="No messages yet. Say hello, or ask the model to describe itself — anything that confirms the provider is reachable." />
    </div>
  )
}
