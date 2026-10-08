import api from './api'

const matchingService = {
  getTripCompatibility: async (tripId) =>
    (await api.get(`/trips/${tripId}/compatibility`)).data.data,
  refreshTripCompatibility: async (tripId) =>
    (await api.post(`/trips/${tripId}/matches/refresh`)).data.data.match,
  listMatches: async (params = {}) =>
    (await api.get('/matches', { params })).data.data,
  getMatch: async (matchId) =>
    (await api.get(`/matches/${matchId}`)).data.data.match,
}

export default matchingService
