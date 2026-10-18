import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Send } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import chatService, { getChatSocket } from '../services/chatService'
import './ChatPage.css'

const apiError = (error) => error.response?.data?.error?.message || error.message || 'Chat is temporarily unavailable.'
const withMessage = (items, message) => items.some((item) => item.id === message.id)
  ? items.map((item) => item.id === message.id ? { ...item, ...message } : item)
  : [...items, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
const makeKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`

export default function ChatPage() {
  const user = useAuthStore((state) => state.user)
  const conversations = useChatStore((state) => state.conversations)
  const setConversations = useChatStore((state) => state.setConversations)
  const clearConversations = useChatStore((state) => state.clear)
  const [connections, setConnections] = useState([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [typingUser, setTypingUser] = useState('')
  const [online, setOnline] = useState(false)
  const socketRef = useRef(null)
  const activeIdRef = useRef('')
  const conversationsRef = useRef([])
  const typingTimer = useRef(null)
  const typingActive = useRef(false)

  const loadConversations = useCallback(async () => {
    try {
      const result = await chatService.list()
      setConversations(result.items)
      setActiveId((current) => current && result.items.some((item) => item.id === current) ? current : result.items[0]?.id || '')
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setLoading(false) }
  }, [setConversations])

  useEffect(() => {
    let cancelled = false
    clearConversations()
    Promise.all([chatService.list(), chatService.connections()]).then(([result, accepted]) => {
      if (cancelled) return
      setConversations(result.items)
      setConnections(accepted)
      const requestedId = new URLSearchParams(window.location.search).get('conversation')
      const initialConversation = result.items.find((item) => item.id === requestedId) || result.items[0]
      setActiveId(initialConversation?.id || '')
      setHistoryLoading(Boolean(initialConversation))
    }).catch((requestError) => { if (!cancelled) setError(apiError(requestError)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clearConversations, setConversations])

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { conversationsRef.current = conversations }, [conversations])

  useEffect(() => {
    const socket = getChatSocket()
    socketRef.current = socket
    const onConnect = () => {
      setOnline(true)
      if (activeIdRef.current) void chatService.socketRequest(socket, 'chat:join', { conversationId: activeIdRef.current }).catch(() => {})
    }
    const onDisconnect = () => setOnline(false)
    const onConnectError = () => setOnline(false)
    const onMessage = (message) => {
      setConversations((items) => items.map((item) => item.id === message.conversationId
        ? { ...item, lastMessageAt: message.createdAt, lastMessage: message.id, unreadCount: item.id === activeIdRef.current ? 0 : item.unreadCount + 1 }
        : item))
      if (message.conversationId === activeIdRef.current) {
        setMessages((items) => withMessage(items, message))
        void chatService.markRead(message.conversationId, message.id).then(loadConversations).catch(() => {})
      } else {
        void loadConversations()
      }
    }
    const onDelivered = (event) => setMessages((items) => items.map((message) => message.id === event.messageId
      ? { ...message, deliveredTo: [...new Set([...(message.deliveredTo || []), ...event.deliveredTo])] }
      : message))
    const onRead = (event) => setMessages((items) => {
      const cutoffIndex = event.upToMessageId ? items.findIndex((message) => message.id === event.upToMessageId) : items.length - 1
      return items.map((message, index) => message.conversationId === event.conversationId && cutoffIndex >= 0 && index <= cutoffIndex
        ? { ...message, readBy: [...new Set([...(message.readBy || []), event.readerId])] }
        : message)
    })
    const onTyping = (event) => {
      if (event.conversationId !== activeIdRef.current || event.userId === user?.id) return
      const current = conversationsRef.current.find((item) => item.id === event.conversationId)
      const name = current?.participants.find((participant) => participant.id === event.userId)?.name || 'A participant'
      setTypingUser(event.active ? name : '')
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (event.active) typingTimer.current = setTimeout(() => setTypingUser(''), 2500)
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('chat:message:new', onMessage)
    socket.on('chat:message:delivered', onDelivered)
    socket.on('chat:message:read', onRead)
    socket.on('chat:typing', onTyping)
    setOnline(socket.connected)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('chat:message:new', onMessage)
      socket.off('chat:message:delivered', onDelivered)
      socket.off('chat:message:read', onRead)
      socket.off('chat:typing', onTyping)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      socketRef.current = null
    }
  }, [loadConversations, setConversations, user?.id])

  useEffect(() => {
    if (!activeId) return undefined
    let cancelled = false
    const socket = socketRef.current
    Promise.all([
      chatService.detail(activeId),
      chatService.history(activeId),
      socket?.connected ? chatService.socketRequest(socket, 'chat:join', { conversationId: activeId }) : Promise.resolve(null),
    ]).then(([detail, history]) => {
      if (cancelled) return
      setConversations((items) => items.map((item) => item.id === detail.id ? detail : item))
      setMessages(history.items)
      setNextCursor(history.nextCursor)
      setHasMore(history.hasMore)
      const lastMessage = history.items.at(-1)
      void chatService.markRead(activeId, lastMessage?.id).then(() => {
        setConversations((items) => items.map((item) => item.id === activeId ? { ...item, unreadCount: 0 } : item))
      }).catch(() => {})
    }).catch((requestError) => { if (!cancelled) setError(apiError(requestError)) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => {
      cancelled = true
      if (socket?.connected) void chatService.socketRequest(socket, 'chat:leave', { conversationId: activeId }).catch(() => {})
    }
  }, [activeId, setConversations])

  const startDirect = async (connectionId) => {
    setError('')
    try {
      const conversation = await chatService.direct(connectionId)
      setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)])
      stopTyping(activeId)
      setMessages([])
      setHistoryLoading(true)
      setActiveId(conversation.id)
    } catch (requestError) { setError(apiError(requestError)) }
  }

  const stopTyping = (conversationId = activeId) => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
    if (typingActive.current && socketRef.current?.connected && conversationId) {
      void chatService.socketRequest(socketRef.current, 'chat:typing', { conversationId, active: false }).catch(() => {})
    }
    typingActive.current = false
  }

  const selectConversation = (id) => {
    if (id === activeId) return
    stopTyping(activeId)
    setMessages([])
    setHistoryLoading(true)
    setError('')
    setActiveId(id)
  }

  const loadOlder = async () => {
    if (!nextCursor || historyLoading || !activeId) return
    setHistoryLoading(true)
    try {
      const older = await chatService.history(activeId, nextCursor)
      setMessages((items) => [...older.items, ...items.filter((item) => !older.items.some((message) => message.id === item.id))])
      setNextCursor(older.nextCursor)
      setHasMore(older.hasMore)
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setHistoryLoading(false) }
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    const content = text.trim()
    if (!content || content.length > 4000 || !activeId || sending) return
    setSending(true)
    setError('')
    const payload = { text: content, idempotencyKey: makeKey() }
    try {
      let message
      if (socketRef.current?.connected) {
        try {
          const result = await chatService.socketRequest(socketRef.current, 'chat:message:send', { conversationId: activeId, ...payload })
          message = result.message
        } catch {
          message = await chatService.send(activeId, payload)
        }
      } else message = await chatService.send(activeId, payload)
      setMessages((items) => withMessage(items, message))
      setText('')
      void loadConversations()
    } catch (requestError) { setError(apiError(requestError)) }
    finally { setSending(false) }
  }

  const active = conversations.find((item) => item.id === activeId)
  const title = active?.type === 'TRIP' ? active.trip?.title || 'Trip conversation' : active?.participants.find((participant) => participant.id !== user?.id)?.name || 'Conversation'

  return <main className="chat-page">
    <header className="chat-header"><Link to="/" className="chat-brand">TripBuddy</Link><h1>Messages</h1><nav><Link to="/connections">Connections</Link><span className={online ? 'chat-connection online' : 'chat-connection'}>{online ? 'Connected' : 'Reconnecting…'}</span></nav></header>
    {error && <p className="chat-error" role="alert">{error}</p>}
    <div className="chat-layout">
      <aside className={`chat-sidebar ${activeId ? 'has-active' : ''}`} aria-label="Conversations">
        <div className="chat-sidebar-heading"><h2>Conversations</h2><span>{conversations.reduce((sum, item) => sum + item.unreadCount, 0)} unread</span></div>
        {loading ? <p role="status" className="chat-empty">Loading conversations…</p> : conversations.length ? <ul className="chat-conversation-list">
            {conversations.map((conversation) => {
            const counterpart = conversation.participants.find((participant) => participant.id !== user?.id)?.name
            const label = conversation.type === 'TRIP' ? conversation.trip?.title || 'Trip conversation' : counterpart || 'Direct conversation'
            return <li key={conversation.id}><button type="button" className={`chat-conversation ${activeId === conversation.id ? 'selected' : ''}`} onClick={() => selectConversation(conversation.id)} aria-current={activeId === conversation.id ? 'page' : undefined}>
              <span className="chat-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span><span className="chat-conversation-copy"><strong>{label}</strong><small>{conversation.type === 'TRIP' ? 'Trip chat' : 'Direct conversation'}</small></span>{conversation.unreadCount > 0 && <span className="chat-unread" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</span>}
            </button></li>
          })}
        </ul> : <p className="chat-empty">No conversations yet. Start one with an accepted connection below.</p>}
        {connections.length > 0 && <section className="chat-start-list"><h3>Start a direct chat</h3>{connections.map((connection) => <button key={connection.id} type="button" onClick={() => startDirect(connection.id)}><MessageCircle size={16} aria-hidden="true" />{connection.otherUser?.name || 'Connected traveller'}</button>)}</section>}
      </aside>
      <section className={`chat-panel ${activeId ? 'has-active' : ''}`} aria-label="Conversation">
        {active ? <>
          <header className="chat-panel-header"><button className="chat-mobile-back" type="button" onClick={() => { stopTyping(activeId); setActiveId('') }} aria-label="Back to conversations"><ArrowLeft size={19} /></button><div><h2>{title}</h2><p>{active.type === 'TRIP' ? `${active.participants.length} trip members` : 'Accepted connection'}</p></div></header>
          <div className="chat-history" role="log" aria-label="Message history" aria-live="polite">
            {hasMore && <button className="chat-load-older" type="button" disabled={historyLoading} onClick={loadOlder}>{historyLoading ? 'Loading…' : 'Load older messages'}</button>}
            {historyLoading && messages.length === 0 && <p role="status" className="chat-empty">Loading messages…</p>}
            {!historyLoading && messages.length === 0 && <p className="chat-empty">This conversation is ready. Send the first message.</p>}
            {messages.map((message) => {
              const mine = message.senderId === user?.id
              const read = mine && (message.readBy || []).some((id) => id !== user?.id)
              const delivered = mine && (message.deliveredTo || []).length > 0
              return <article className={`chat-message ${mine ? 'mine' : ''}`} key={message.id}><p>{message.text}</p><footer><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{mine && <span>{read ? active.type === 'TRIP' ? `Read by ${(message.readBy || []).filter((id) => id !== user?.id).length}` : 'Read' : delivered ? 'Delivered' : 'Sent'}</span>}</footer></article>
            })}
          </div>
          <p className="chat-typing" role="status">{typingUser ? `${typingUser} is typing…` : '\u00a0'}</p>
          <form className="chat-composer" onSubmit={sendMessage}><label className="visually-hidden" htmlFor="chat-message">Message</label><textarea id="chat-message" value={text} maxLength={4000} rows={2} placeholder="Write a message…" onChange={(event) => {
            setText(event.target.value)
            if (event.target.value.trim() && socketRef.current?.connected && activeId) {
              if (!typingActive.current) void chatService.socketRequest(socketRef.current, 'chat:typing', { conversationId: activeId, active: true }).catch(() => {})
              typingActive.current = true
              if (typingTimer.current) clearTimeout(typingTimer.current)
              typingTimer.current = setTimeout(() => {
                if (socketRef.current?.connected && activeId) void chatService.socketRequest(socketRef.current, 'chat:typing', { conversationId: activeId, active: false }).catch(() => {})
                typingActive.current = false
              }, 1500)
            } else if (!event.target.value.trim() && typingActive.current) {
              if (typingTimer.current) clearTimeout(typingTimer.current)
              typingActive.current = false
              if (socketRef.current?.connected && activeId) void chatService.socketRequest(socketRef.current, 'chat:typing', { conversationId: activeId, active: false }).catch(() => {})
            }
          }} onBlur={() => stopTyping(activeId)} /><button type="submit" className="chat-send" disabled={!text.trim() || sending || text.trim().length > 4000} aria-label="Send message">{sending ? 'Sending…' : <><Send size={17} aria-hidden="true" />Send</>}</button></form>
          <p className="chat-character-count">{text.length}/4000</p>
        </> : <div className="chat-welcome"><MessageCircle size={32} aria-hidden="true" /><h2>Your travel conversations</h2><p>Choose a conversation or start with someone you are connected with.</p></div>}
      </section>
    </div>
  </main>
}
