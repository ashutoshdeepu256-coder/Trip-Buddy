import api from './api'

const data = (promise) => promise.then((response) => response.data.data)
const adminService = {
  overview: () => data(api.get('/admin/overview')),
  analytics: (params) => data(api.get('/admin/analytics', { params })),
  users: (params) => data(api.get('/admin/users', { params })),
  trips: (params) => data(api.get('/admin/trips', { params })),
  audit: (params) => data(api.get('/admin/audit', { params })),
  setStatus: (id, values) => data(api.patch(`/admin/users/${encodeURIComponent(id)}/status`, values)),
  setRole: (id, values) => data(api.patch(`/admin/users/${encodeURIComponent(id)}/role`, values)),
}

export default adminService
