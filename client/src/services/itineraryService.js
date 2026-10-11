import api from './api'

const list = async (params = {}) => (await api.get('/itineraries', { params })).data.data
const get = async (id) => (await api.get(`/itineraries/${encodeURIComponent(id)}`)).data.data
const generate = async (input) => (await api.post('/itineraries/generate', input)).data.data
const update = async (id, values) => (await api.patch(`/itineraries/${encodeURIComponent(id)}`, values)).data.data
const regenerateDay = async (id, day) => (await api.post(`/itineraries/${encodeURIComponent(id)}/days/${day}/regenerate`)).data.data
const duplicate = async (id) => (await api.post(`/itineraries/${encodeURIComponent(id)}/duplicate`)).data.data
const archive = async (id) => (await api.post(`/itineraries/${encodeURIComponent(id)}/archive`)).data.data
const remove = async (id) => (await api.delete(`/itineraries/${encodeURIComponent(id)}`)).data.data

export default { list, get, generate, update, regenerateDay, duplicate, archive, remove }
