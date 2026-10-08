import api from './api'

const searchTrips = async (params = {}) =>
  (await api.get('/trips', { params })).data.data

export default { searchTrips }
