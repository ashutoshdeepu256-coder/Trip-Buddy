import { create } from 'zustand'
import tripService from '../services/tripService'

const messageFor = (error, fallback) => error.response?.data?.error?.message || fallback

export const useTripStore = create((set) => ({
  currentTrip: null,
  myTrips: [],
  loading: false,
  saving: false,
  error: null,
  pagination: {
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  clearError: () => set({ error: null }),
  fetchTrip: async (tripId) => {
    set({ loading: true, error: null, currentTrip: null })
    try {
      const currentTrip = await tripService.getTrip(tripId)
      set({ currentTrip })
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip could not be loaded.') })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  createTrip: async (values) => {
    set({ saving: true, error: null })
    try {
      const currentTrip = await tripService.createTrip(values)
      set((state) => ({ currentTrip, myTrips: [currentTrip, ...state.myTrips] }))
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip draft could not be saved.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  updateTrip: async (tripId, values) => {
    set({ saving: true, error: null })
    try {
      const currentTrip = await tripService.updateTrip(tripId, values)
      set((state) => ({
        currentTrip,
        myTrips: state.myTrips.map((trip) => trip.id === currentTrip.id ? currentTrip : trip),
      }))
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip could not be updated.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  deleteTrip: async (tripId) => {
    set({ saving: true, error: null })
    try {
      const result = await tripService.deleteTrip(tripId)
      set((state) => ({
        currentTrip: state.currentTrip?.id === tripId ? null : state.currentTrip,
        myTrips: state.myTrips.filter((trip) => trip.id !== tripId),
      }))
      return result
    } catch (error) {
      set({ error: messageFor(error, 'Draft could not be deleted.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  publishTrip: async (tripId) => {
    set({ saving: true, error: null })
    try {
      const currentTrip = await tripService.publishTrip(tripId)
      set((state) => ({
        currentTrip,
        myTrips: state.myTrips.map((trip) => trip.id === currentTrip.id ? currentTrip : trip),
      }))
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip could not be published.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  cancelTrip: async (tripId) => {
    set({ saving: true, error: null })
    try {
      const currentTrip = await tripService.cancelTrip(tripId)
      set((state) => ({
        currentTrip,
        myTrips: state.myTrips.map((trip) => trip.id === currentTrip.id ? currentTrip : trip),
      }))
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip could not be cancelled.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  changeTripStatus: async (tripId, status) => {
    set({ saving: true, error: null })
    try {
      const currentTrip = await tripService.changeTripStatus(tripId, status)
      set((state) => ({
        currentTrip,
        myTrips: state.myTrips.map((trip) => trip.id === currentTrip.id ? currentTrip : trip),
      }))
      return currentTrip
    } catch (error) {
      set({ error: messageFor(error, 'Trip status could not be changed.') })
      throw error
    } finally {
      set({ saving: false })
    }
  },
  fetchMyTrips: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const result = await tripService.getMyTrips(params)
      set({ myTrips: result.items, pagination: result })
      return result
    } catch (error) {
      set({ error: messageFor(error, 'Your trips could not be loaded.') })
      throw error
    } finally {
      set({ loading: false })
    }
  },
}))
