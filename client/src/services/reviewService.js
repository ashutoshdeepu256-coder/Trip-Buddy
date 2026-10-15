import api from './api'

const listTraveller = async (userId, params = {}) => (await api.get(`/reviews/travellers/${encodeURIComponent(userId)}`, { params })).data.data
const listTrip = async (tripId, params = {}) => (await api.get(`/reviews/trips/${encodeURIComponent(tripId)}`, { params })).data.data
const eligibility = async (tripId) => (await api.get(`/reviews/trips/${encodeURIComponent(tripId)}/eligibility`)).data.data
const create = async (data) => (await api.post('/reviews', data)).data.data
const update = async (reviewId, data) => (await api.patch(`/reviews/${encodeURIComponent(reviewId)}`, data)).data.data
const remove = async (reviewId) => (await api.delete(`/reviews/${encodeURIComponent(reviewId)}`)).data.data
const report = async (reviewId, data) => (await api.post(`/reviews/${encodeURIComponent(reviewId)}/reports`, data)).data.data

export default { listTraveller, listTrip, eligibility, create, update, remove, report }
