import { useState } from 'react'
import connectionService from '../../services/connectionService'

export default function ConnectionRequestButton({ recipientId, tripId, className = 'primary-btn' }) {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const send = async () => {
    if (status === 'loading') return
    if (status === 'idle' && !window.confirm('Send this traveller a connection request?')) return
    setStatus('loading')
    setMessage('')
    try {
      await connectionService.send(recipientId, tripId)
      setStatus('sent')
      setMessage('Request sent. You can track it in your sent requests.')
    } catch (error) {
      setStatus('idle')
      setMessage(error.response?.data?.error?.message || 'The request could not be sent.')
    }
  }
  return <div className="connection-request-action">
    <button type="button" className={className} onClick={send} disabled={status === 'loading' || status === 'sent'}>
      {status === 'loading' ? 'Sending…' : status === 'sent' ? 'Request sent' : 'Connect'}
    </button>
    {message && <p role="status">{message}</p>}
  </div>
}
