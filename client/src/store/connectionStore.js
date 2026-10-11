import { create } from 'zustand'
import connectionService from '../services/connectionService'

const errorMessage = (error) => error.response?.data?.error?.message || 'Connections could not be loaded.'

export const useConnectionStore = create((set) => ({
  items: [],
  page: 1,
  total: 0,
  loading: false,
  savingId: null,
  error: '',
  load: async (kind, page = 1) => {
    set({ loading: true, error: '' })
    try {
      const result = await connectionService[kind]({ page, limit: 20 })
      set((state) => ({ items: page > 1 ? [...state.items, ...result.items] : result.items, page: result.page, total: result.total, loading: false }))
    } catch (error) {
      set({ error: errorMessage(error), loading: false })
    }
  },
  act: async (id, action) => {
    set({ savingId: id, error: '' })
    try {
      const result = await connectionService[action](id)
      set((state) => ({
        items: state.items.map((item) => item.id === id ? result : item),
        savingId: null,
      }))
      return result
    } catch (error) {
      set({ error: errorMessage(error), savingId: null })
      throw error
    }
  },
}))
