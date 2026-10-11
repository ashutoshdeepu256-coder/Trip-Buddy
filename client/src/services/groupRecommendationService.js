import api from './api'

const groupRecommendationService = {
  generate: async (tripId) =>
    (await api.post(`/trips/${tripId}/group-recommendations/generate`)).data.data,
  listForTrip: async (tripId) =>
    (await api.get(`/trips/${tripId}/group-recommendations`)).data.data,
  get: async (recommendationId) =>
    (await api.get(`/group-recommendations/${recommendationId}`)).data.data.recommendation,
  accept: async (recommendationId) =>
    (await api.post(`/group-recommendations/${recommendationId}/accept`)).data.data.recommendation,
  reject: async (recommendationId) =>
    (await api.post(`/group-recommendations/${recommendationId}/reject`)).data.data.recommendation,
}

export default groupRecommendationService
