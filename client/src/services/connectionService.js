import api from './api'

const connectionService = {
  send: async (recipientId, tripId) => (await api.post('/connections', { recipientId, ...(tripId ? { tripId } : {}) })).data.data.connection,
  list: async (params = {}) => (await api.get('/connections', { params })).data.data,
  received: async (params = {}) => (await api.get('/connections/requests/received', { params })).data.data,
  sent: async (params = {}) => (await api.get('/connections/requests/sent', { params })).data.data,
  detail: async (id) => (await api.get(`/connections/${id}`)).data.data.connection,
  accept: async (id) => (await api.post(`/connections/${id}/accept`)).data.data.connection,
  reject: async (id) => (await api.post(`/connections/${id}/reject`)).data.data.connection,
  cancel: async (id) => (await api.post(`/connections/${id}/cancel`)).data.data.connection,
  unmatch: async (id) => (await api.post(`/connections/${id}/unmatch`)).data.data.connection,
}

export default connectionService
