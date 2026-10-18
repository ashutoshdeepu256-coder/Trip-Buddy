import api from './api'

const safetyService = {
  settings: async () => (await api.get('/safety/settings')).data.data.settings,
  updateSettings: async (values) => (await api.patch('/safety/settings', values)).data.data.settings,
  blocked: async () => (await api.get('/safety/blocked-users')).data.data,
  block: async (userId) => (await api.post(`/safety/block/${encodeURIComponent(userId)}`)).data.data,
  unblock: async (userId) => (await api.delete(`/safety/block/${encodeURIComponent(userId)}`)).data.data,
  contacts: async () => (await api.get('/safety/emergency-contacts')).data.data.items,
  addContact: async (values) => (await api.post('/safety/emergency-contacts', values)).data.data.contact,
  updateContact: async (id, values) => (await api.patch(`/safety/emergency-contacts/${encodeURIComponent(id)}`, values)).data.data.contact,
  removeContact: async (id) => (await api.delete(`/safety/emergency-contacts/${encodeURIComponent(id)}`)).data.data,
  report: async (values) => (await api.post('/safety/reports', values)).data.data,
  myReports: async () => (await api.get('/safety/reports/mine')).data.data,
  moderatorReports: async (params) => (await api.get('/safety/admin/reports', { params })).data.data,
  resolveReport: async (id, values) => (await api.patch(`/safety/admin/reports/${encodeURIComponent(id)}`, values)).data.data,
  reviewReports: async (params) => (await api.get('/admin/reviews/reports', { params })).data.data,
  resolveReviewReport: async (id, values) => (await api.patch(`/admin/reviews/reports/${encodeURIComponent(id)}`, values)).data.data,
  moderateReview: async (id, values) => (await api.patch(`/admin/reviews/${encodeURIComponent(id)}`, values)).data.data,
  moderationQueue: async (params = {}) => (await api.get('/safety/admin/moderation', { params })).data.data,
  decideModeration: async (id, values) => (await api.patch(`/safety/admin/moderation/${encodeURIComponent(id)}`, values)).data.data,
  appealModeration: async (id, reason) => (await api.post(`/safety/moderation/${encodeURIComponent(id)}/appeal`, { reason })).data.data,
  tripSafety: async (tripId) => (await api.get(`/safety/trips/${encodeURIComponent(tripId)}`)).data.data,
  updateTripSafety: async (tripId, values) => (await api.patch(`/safety/trips/${encodeURIComponent(tripId)}`, values)).data.data,
}

export default safetyService
