import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, Bot, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import assistantService from '../services/assistantService'
import './TravelAssistant.css'

const prompts = [
  'Show me stored destination ideas for a relaxed weekend.',
  'Give me a practical travel-preparation checklist.',
  'What should I consider for a safer first meeting with a travel companion?',
]
const explain = (error) => {
  const message = error.response?.data?.error?.message
  if (error.response?.data?.error?.code === 'ASSISTANT_REQUEST_PROCESSING') return 'This request is still processing. If it remains unfinished, retry after about one minute.'
  return message || 'The assistant could not complete that request. You can retry it.'
}
const makeRequestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`

export default function TravelAssistant() {
  const [conversations, setConversations] = useState([])
  const [conversationId, setConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pendingRetry, setPendingRetry] = useState(null)
  const [usage, setUsage] = useState(null)
  const [tripId, setTripId] = useState('')
  const [itineraryId, setItineraryId] = useState('')
  const [plannerDestination, setPlannerDestination] = useState('')
  const [plannerStartDate, setPlannerStartDate] = useState('')
  const [plannerEndDate, setPlannerEndDate] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    let active = true
    Promise.all([assistantService.list({ page: 1, limit: 30 }), assistantService.usage()])
      .then(([list, limits]) => {
        if (!active) return
        setConversations(list.items)
        setUsage(limits)
        if (list.items[0]) setConversationId(list.items[0].id)
      })
      .catch((fetchError) => active && setError(explain(fetchError)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!conversationId) return undefined
    let active = true
    assistantService.history(conversationId, { page: 1, limit: 50 })
      .then((result) => active && setMessages(result.items))
      .catch((fetchError) => active && setError(explain(fetchError)))
    return () => { active = false }
  }, [conversationId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, sending])

  const newConversation = async () => {
    setError('')
    try {
      const conversation = await assistantService.create()
      setConversations((items) => [conversation, ...items])
      setConversationId(conversation.id)
      setMessages([])
      setPendingRetry(null)
      setDraft('')
    } catch (createError) { setError(explain(createError)) }
  }

  const submit = async (event, retry = false) => {
    event?.preventDefault()
    const content = retry ? pendingRetry?.content : draft.trim()
    if (!content || sending) return
    setError('')
    let requestId = retry ? pendingRetry?.requestId : ''
    if (!requestId) requestId = makeRequestId()
    if (!conversationId) {
      try {
        const conversation = await assistantService.create()
        setConversations((items) => [conversation, ...items])
        setConversationId(conversation.id)
        await sendTo(conversation.id, content, requestId, contextForSend())
      } catch (sendError) { setError(explain(sendError)) }
      return
    }
    await sendTo(conversationId, content, requestId, contextForSend())
  }

  const contextForSend = () => ({ tripId: tripId.trim(), itineraryId: itineraryId.trim(), ...(plannerDestination.trim() && plannerStartDate && plannerEndDate ? { plannerInput: { destination: plannerDestination.trim(), startDate: plannerStartDate, endDate: plannerEndDate } } : {}) })

  const sendTo = async (id, content, requestId, context = {}) => {
    setSending(true)
    setPendingRetry({ content, requestId, context })
    try {
      const selectedContext = Object.fromEntries(Object.entries(context).filter(([, value]) => value))
      const result = await assistantService.send(id, { content, requestId, ...(Object.keys(selectedContext).length ? { context: selectedContext } : {}) })
      setMessages((items) => [...items, result.userMessage, result.assistantMessage])
      setDraft('')
      setPendingRetry(null)
      const [items, limits] = await Promise.all([assistantService.list({ page: 1, limit: 30 }), assistantService.usage()])
      setConversations(items.items)
      setUsage(limits)
    } catch (sendError) { setError(explain(sendError)) }
    finally { setSending(false) }
  }

  const archiveSelected = async () => {
    if (!conversationId) return
    try {
      await assistantService.archive(conversationId)
      setConversations((items) => items.filter((item) => item.id !== conversationId))
      setConversationId('')
      setMessages([])
    } catch (archiveError) { setError(explain(archiveError)) }
  }

  const deleteSelected = async () => {
    if (!conversationId || !window.confirm('Delete this conversation and its stored messages?')) return
    try {
      await assistantService.remove(conversationId)
      setConversations((items) => items.filter((item) => item.id !== conversationId))
      setConversationId('')
      setMessages([])
      setPendingRetry(null)
    } catch (deleteError) { setError(explain(deleteError)) }
  }

  return (
    <main className="assistant-shell">
      <header className="assistant-heading">
        <div><p className="assistant-eyebrow">TripBuddy travel assistant</p><h1>Plan with context</h1><p>Stored TripBuddy records are separated from AI suggestions. No live prices, weather, bookings, or availability are provided.</p></div>
        <Link className="secondary-btn" to="/planner">Open itinerary planner</Link>
      </header>
      <div className="assistant-layout">
        <aside className="assistant-sidebar" aria-label="Assistant conversations">
          <button className="primary-btn" type="button" onClick={newConversation}><Plus size={17} /> New conversation</button>
          {loading ? <p role="status">Loading conversations…</p> : conversations.length === 0 ? <p className="assistant-muted">Your saved conversations will appear here.</p> : conversations.map((conversation) => (
            <button key={conversation.id} type="button" className={`assistant-conversation ${conversation.id === conversationId ? 'active' : ''}`} onClick={() => { setConversationId(conversation.id); setMessages([]); setError(''); setPendingRetry(null) }}>
              <MessageCircle size={16} /><span>{conversation.title}</span>
            </button>
          ))}
          {usage && <p className="assistant-usage">Today: {usage.remainingRequests} of {usage.dailyRequestLimit} requests remaining. {usage.providerConfigured ? 'Gemini configured.' : 'Using the built-in fallback.'}</p>}
        </aside>
        <section className="assistant-panel" aria-label="Travel assistant conversation">
          <div className="assistant-toolbar">
            <span><Bot size={18} /> {conversationId ? conversations.find((item) => item.id === conversationId)?.title || 'Travel conversation' : 'Start a conversation'}</span>
            {conversationId && <div><button type="button" aria-label="Archive conversation" title="Archive" onClick={archiveSelected}><Archive size={17} /></button><button type="button" aria-label="Delete conversation" title="Delete" onClick={deleteSelected}><Trash2 size={17} /></button></div>}
          </div>
          <div className="assistant-messages" aria-live="polite">
            {!messages.length && <div className="assistant-welcome"><h2>What are you planning?</h2><p>Ask for a checklist, destination ideas, or details from an itinerary, trip, expense ledger, or compatibility result you can access.</p><div>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div><small>Only add a record ID if your account can open that TripBuddy trip or itinerary. Records are checked against your current access.</small></div>}
            {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role.toLowerCase()}`}>
              <div className="assistant-message-label">{message.role === 'USER' ? 'You' : message.source === 'GEMINI' ? 'AI suggestion' : 'TripBuddy fallback'}</div>
              <p>{message.content}</p>
              {message.role === 'ASSISTANT' && message.references?.length > 0 && <div className="assistant-references"><strong>TripBuddy records</strong>{message.references.map((reference) => <Link key={`${reference.kind}-${reference.route}`} to={reference.route}>{reference.label}</Link>)}</div>}
            </article>)}
            {sending && <p className="assistant-pending" role="status">Checking authorized TripBuddy context and preparing a reply…</p>}
            <div ref={endRef} />
          </div>
          {error && <div className="assistant-error" role="alert">{error}{pendingRetry && <button type="button" disabled={sending} onClick={() => sendTo(conversationId, pendingRetry.content, pendingRetry.requestId, pendingRetry.context)}>Retry</button>}</div>}
          <form className="assistant-compose" onSubmit={submit}>
            <div className="assistant-context-fields">
              <label>Optional trip ID<input value={tripId} onChange={(event) => setTripId(event.target.value.trim().slice(0, 24))} placeholder="Paste an authorized trip ID" maxLength={24} /></label>
              <label>Optional itinerary ID<input value={itineraryId} onChange={(event) => setItineraryId(event.target.value.trim().slice(0, 24))} placeholder="Paste an authorized itinerary ID" maxLength={24} /></label>
            </div>
            <div className="assistant-context-fields assistant-planner-fields">
              <label>Optional itinerary preview destination<input value={plannerDestination} onChange={(event) => setPlannerDestination(event.target.value.slice(0, 160))} placeholder="Destination for a non-saving draft" maxLength={160} /></label>
              <label>Start date<input type="date" value={plannerStartDate} onChange={(event) => setPlannerStartDate(event.target.value)} /></label>
              <label>End date<input type="date" value={plannerEndDate} onChange={(event) => setPlannerEndDate(event.target.value)} /></label>
            </div>
            <label className="sr-only" htmlFor="assistant-message-input">Message the travel assistant</label>
            <textarea id="assistant-message-input" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 4000))} maxLength={4000} rows={3} placeholder="Ask a travel question…" disabled={sending} />
            <div><small>{draft.length}/4000 characters · AI replies are not live travel data.</small><button className="primary-btn" type="submit" disabled={sending || !draft.trim() || usage?.remainingRequests === 0}>{sending ? 'Preparing…' : 'Send'} <Send size={16} /></button></div>
          </form>
        </section>
      </div>
    </main>
  )
}
