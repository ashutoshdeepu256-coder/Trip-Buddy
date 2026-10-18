import { create } from 'zustand'
import notificationService from '../services/notificationService'
import { disconnectChatSocket, getChatSocket } from '../services/chatService'

let activeUserId = null
let handlers = null

const mergeItem = (items, incoming) => {
  const present = items.some((item) => item.id === incoming.id)
  return present ? items.map((item) => item.id === incoming.id ? { ...item, ...incoming } : item) : [incoming, ...items]
}

export const useNotificationStore = create((set, get) => ({
  items: [], page: 1, limit: 20, total: 0, totalPages: 0, unreadCount: 0,
  seenSocketIds: [],
  online: false, loading: false, error: '',
  setOnline: (online) => set({ online }),
  setUnreadCount: (unreadCount) => set({ unreadCount: Math.max(0, Number(unreadCount) || 0) }),
  loadPage: async (page = 1) => {
    set({ loading: true, error: '' })
    try {
      const result = await notificationService.list(page, get().limit)
      set({ items: result.items || [], page: result.page, total: result.total, totalPages: result.totalPages, loading: false })
    } catch (error) { set({ loading: false, error: error.response ? 'Notifications could not be loaded.' : 'You are offline. Saved notifications will sync when you reconnect.' }) }
  },
  refreshCount: async () => {
    try { set({ unreadCount: await notificationService.unreadCount() }) } catch { /* Keep last server count while offline. */ }
  },
  resync: async () => { await Promise.all([get().refreshCount(), get().loadPage(get().page)]) },
  markRead: async (id) => {
    const result = await notificationService.markRead(id)
    set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, readAt: result.notification.readAt } : item), unreadCount: result.unreadCount }))
  },
  markAllRead: async () => {
    await notificationService.markAllRead()
    set((state) => ({ items: state.items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })), unreadCount: 0 }))
  },
  dismiss: async (id) => {
    const result = await notificationService.dismiss(id)
    set((state) => ({ items: state.items.filter((item) => item.id !== id), total: Math.max(0, state.total - 1), unreadCount: result.unreadCount }))
  },
  start: (userId) => {
    if (!userId || activeUserId === userId) return
    if (activeUserId) get().stop()
    activeUserId = userId
    const socket = getChatSocket()
    const onConnect = () => { get().setOnline(true); void get().resync() }
    const onDisconnect = () => get().setOnline(false)
    const onNew = (item) => {
      set((state) => {
        if (state.seenSocketIds.includes(item.id)) return state
        const alreadyLoaded = state.items.some((entry) => entry.id === item.id)
        return { items: state.page === 1 ? mergeItem(state.items, item) : state.items, total: state.total + (alreadyLoaded ? 0 : 1), seenSocketIds: [...state.seenSocketIds.slice(-99), item.id] }
      })
      void get().refreshCount()
    }
    const onRead = (event) => set((state) => ({ items: event.all ? state.items.map((item) => ({ ...item, readAt: item.readAt || event.readAt })) : state.items.map((item) => item.id === event.id ? { ...item, readAt: event.readAt } : item) }))
    const onCount = ({ count }) => get().setUnreadCount(count)
    handlers = { socket, onConnect, onDisconnect, onNew, onRead, onCount }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('notifications:new', onNew)
    socket.on('notifications:read', onRead)
    socket.on('notifications:unread-count', onCount)
    set({ online: socket.connected })
    void get().resync()
  },
  stop: () => {
    if (handlers) {
      const { socket, onConnect, onDisconnect, onNew, onRead, onCount } = handlers
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect)
      socket.off('notifications:new', onNew); socket.off('notifications:read', onRead)
      socket.off('notifications:unread-count', onCount)
    }
    handlers = null
    activeUserId = null
    disconnectChatSocket()
    set({ online: false, items: [], unreadCount: 0, total: 0, totalPages: 0, page: 1, seenSocketIds: [], error: '' })
  },
}))
