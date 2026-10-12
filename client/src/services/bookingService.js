import api from './api'

const categories = async () => (await api.get('/bookings/categories')).data.data
const services = async (params = {}) => (await api.get('/bookings/services', { params })).data.data
const list = async (params = {}) => (await api.get('/bookings', { params })).data.data
const create = async (data, idempotencyKey) => (await api.post('/bookings', data, { headers: { 'Idempotency-Key': idempotencyKey } })).data.data
const cancel = async (id) => (await api.post(`/bookings/${encodeURIComponent(id)}/cancel`)).data.data
const update = async (id, data) => (await api.patch(`/bookings/${encodeURIComponent(id)}`, data)).data.data

export default { categories, services, list, create, cancel, update }
