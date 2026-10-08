import { create } from 'zustand'
import tripDiscoveryService from '../services/tripDiscoveryService'

const messageFor = (error) => error.response?.data?.error?.message || 'Trips could not be loaded.'

export const useTripDiscoveryStore = create((set, get) => {
  let searchRequest = 0
  return {
    filters: {},
    results: [],
    pagination: {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    loading: false,
    loadingMore: false,
    error: null,
    sort: 'recent',
    searchTrips: async (filters = {}) => {
      const requestId = ++searchRequest
      set({ filters, sort: filters.sort || 'recent', results: [], loading: true, loadingMore: false, error: null })
      try {
        const response = await tripDiscoveryService.searchTrips(filters)
        if (requestId === searchRequest) set({ results: response.items, pagination: response })
        return response
      } catch (error) {
        if (requestId === searchRequest) set({ error: messageFor(error) })
        throw error
      } finally {
        if (requestId === searchRequest) set({ loading: false })
      }
    },
    loadMore: async (filters = {}) => {
      const state = get()
      if (state.loadingMore || !state.pagination.hasNextPage) return
      const requestId = searchRequest
      const nextPage = state.pagination.page + 1
      set({ loadingMore: true, error: null })
      try {
        const response = await tripDiscoveryService.searchTrips({ ...filters, page: nextPage })
        if (requestId === searchRequest) {
          set((current) => ({
            results: [...current.results, ...response.items],
            pagination: response,
          }))
        }
        return response
      } catch (error) {
        if (requestId === searchRequest) set({ error: messageFor(error) })
        throw error
      } finally {
        if (requestId === searchRequest) set({ loadingMore: false })
      }
    },
    setFilter: (name, value) => set((state) => ({
      filters: { ...state.filters, [name]: value },
    })),
    clearFilters: () => set({ filters: {}, sort: 'recent' }),
    setSort: (sort) => set((state) => ({
      sort,
      filters: { ...state.filters, sort },
    })),
  }
})
