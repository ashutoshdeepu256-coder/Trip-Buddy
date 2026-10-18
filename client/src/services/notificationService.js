import api from './api'

const notificationService = {
  async list(page = 1, limit = 20) { return (await api.get('/notifications', { params: { page, limit } })).data.data },
  async unreadCount() { return (await api.get('/notifications/unread-count')).data.data.count },
  async preferences() { return (await api.get('/notifications/preferences')).data.data.preferences },
  async updatePreferences(categories) { return (await api.patch('/notifications/preferences', { categories })).data.data.preferences },
  async markRead(id) { return (await api.patch(`/notifications/${encodeURIComponent(id)}/read`)).data.data },
  async markAllRead() { return (await api.patch('/notifications/read')).data.data },
  async dismiss(id) { return (await api.delete(`/notifications/${encodeURIComponent(id)}`)).data.data },
}

export default notificationService
