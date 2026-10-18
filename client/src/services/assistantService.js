import api from './api'

const list = async (params = {}) => (await api.get('/assistant/conversations', { params })).data.data
const create = async (values = {}) => (await api.post('/assistant/conversations', values)).data.data.conversation
const history = async (id, params = {}) => (await api.get(`/assistant/conversations/${encodeURIComponent(id)}/messages`, { params })).data.data
const send = async (id, values) => (await api.post(`/assistant/conversations/${encodeURIComponent(id)}/messages`, values)).data.data
const archive = async (id, archived = true) => (await api.patch(`/assistant/conversations/${encodeURIComponent(id)}/archive`, { archived })).data.data
const remove = async (id) => (await api.delete(`/assistant/conversations/${encodeURIComponent(id)}`)).data.data
const usage = async () => (await api.get('/assistant/usage')).data.data

export default { list, create, history, send, archive, remove, usage }
