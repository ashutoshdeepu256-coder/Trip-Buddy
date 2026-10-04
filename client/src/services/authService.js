import api from './api'

const authService = {
  register: async (data) => (await api.post('/auth/register', data)).data.data.user,
  login: async (data) => (await api.post('/auth/login', data)).data.data.user,
  logout: async () => api.post('/auth/logout'),
  getCurrentUser: async () => (await api.get('/auth/me')).data.data.user,
  updateProfile: async (data) => (await api.patch('/users/me', data)).data.data.user,
  getMyProfile: async () => (await api.get('/users/me')).data.data.user,
}

export default authService
