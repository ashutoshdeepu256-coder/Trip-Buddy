import api from './api'

const getTrip = async (tripId) => (await api.get(`/trips/${encodeURIComponent(tripId)}`)).data.data
const createTrip = async (trip) => (await api.post('/trips', trip)).data.data
const updateTrip = async (tripId, trip) =>
  (await api.patch(`/trips/${encodeURIComponent(tripId)}`, trip)).data.data
const deleteTrip = async (tripId) => (await api.delete(`/trips/${encodeURIComponent(tripId)}`)).data.data
const publishTrip = async (tripId) =>
  (await api.post(`/trips/${encodeURIComponent(tripId)}/publish`)).data.data
const cancelTrip = async (tripId) =>
  (await api.post(`/trips/${encodeURIComponent(tripId)}/cancel`)).data.data
const changeTripStatus = async (tripId, status) =>
  (await api.post(`/trips/${encodeURIComponent(tripId)}/status`, { status })).data.data
const getMyTrips = async (params = {}) =>
  (await api.get('/users/me/trips', { params })).data.data
const uploadTripImages = async (tripId, files) => {
  const form = new FormData()
  files.forEach((file) => form.append('images', file))
  return (await api.post(`/trips/${encodeURIComponent(tripId)}/images`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })).data.data
}
const removeTripImage = async (tripId, index) =>
  (await api.delete(`/trips/${encodeURIComponent(tripId)}/images/${index}`)).data.data

export default {
  createTrip,
  getTrip,
  updateTrip,
  deleteTrip,
  publishTrip,
  cancelTrip,
  changeTripStatus,
  getMyTrips,
  uploadTripImages,
  removeTripImage,
}
