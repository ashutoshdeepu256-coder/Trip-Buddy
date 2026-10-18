import api from './api'
import { io } from 'socket.io-client'

let socket

const socketOrigin = () => {
  const configured = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1'
  return new URL(configured, window.location.origin).origin
}

export const getChatSocket = () => {
  if (!socket) socket = io(socketOrigin(), { withCredentials: true, autoConnect: false, reconnection: true, reconnectionAttempts: Infinity })
  if (!socket.connected) socket.connect()
  return socket
}

export const disconnectChatSocket = () => {
  socket?.disconnect()
  socket = undefined
}

const chatService = {
  async list(page = 1) { return (await api.get('/chat/conversations', { params: { page, limit: 50 } })).data.data },
  async detail(id) { return (await api.get(`/chat/conversations/${id}`)).data.data.conversation },
  async history(id, before) { return (await api.get(`/chat/conversations/${id}/messages`, { params: { limit: 40, ...(before ? { before } : {}) } })).data.data },
  async direct(connectionId) { return (await api.post('/chat/conversations/direct', { connectionId })).data.data.conversation },
  async trip(tripId) { return (await api.post(`/chat/trips/${tripId}/conversation`)).data.data.conversation },
  async send(id, payload) { return (await api.post(`/chat/conversations/${id}/messages`, payload)).data.data },
  async markRead(id, upToMessageId) { return (await api.post(`/chat/conversations/${id}/read`, { ...(upToMessageId ? { upToMessageId } : {}) })).data.data },
  async unread() { return (await api.get('/chat/unread')).data.data },
  async connections() { return (await api.get('/connections', { params: { page: 1, limit: 50 } })).data.data.items },
  socketRequest(socketClient, event, payload) {
    return new Promise((resolve, reject) => {
      socketClient.timeout(8000).emit(event, payload, (timeoutError, response) => {
        if (timeoutError) return reject(new Error('The real-time connection did not respond.'))
        if (!response?.success) return reject(new Error(response?.error?.message || 'The chat request could not be completed.'))
        resolve(response.data)
      })
    })
  },
}

export default chatService
