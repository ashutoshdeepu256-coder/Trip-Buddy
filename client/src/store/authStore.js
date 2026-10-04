import { create } from 'zustand'
import authService from '../services/authService'

export const useAuthStore = create((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user, loading: false }),
  fetchMe: async () => {
    set({ loading: true })
    try {
      const user = await authService.getCurrentUser()
      set({ user, loading: false })
    } catch (error) {
      if (error.response?.status !== 401) {
        set({ user: null, loading: false })
        return
      }
      set({ user: null, loading: false })
    }
  },
  logout: async () => {
    try {
      await authService.logout()
    } finally {
      set({ user: null, loading: false })
      window.location.assign('/')
    }
  },
}))
