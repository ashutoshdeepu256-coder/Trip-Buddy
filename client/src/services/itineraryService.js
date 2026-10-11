import api from './api'

const list = async (params = {}) => (await api.get('/itineraries', { params })).data.data
const get = async (id) => (await api.get(`/itineraries/${encodeURIComponent(id)}`)).data.data
const generate = async (input) => (await api.post('/itineraries/generate', input)).data.data
const update = async (id, values) => (await api.patch(`/itineraries/${encodeURIComponent(id)}`, values)).data.data
const regenerateDay = async (id, day) => (await api.post(`/itineraries/${encodeURIComponent(id)}/days/${day}/regenerate`)).data.data
const duplicate = async (id) => (await api.post(`/itineraries/${encodeURIComponent(id)}/duplicate`)).data.data
const archive = async (id) => (await api.post(`/itineraries/${encodeURIComponent(id)}/archive`)).data.data
const remove = async (id) => (await api.delete(`/itineraries/${encodeURIComponent(id)}`)).data.data
const getShared = async (id) => (await api.get(`/itineraries/${encodeURIComponent(id)}/shared`)).data.data
const setCollaboration = async (id, data) => (await api.put(`/itineraries/${encodeURIComponent(id)}/collaboration`, data)).data.data
const collaborators = async (id) => (await api.get(`/itineraries/${encodeURIComponent(id)}/collaborators`)).data.data
const grantCollaborator = async (id, data) => (await api.put(`/itineraries/${encodeURIComponent(id)}/collaborators`, data)).data.data
const revokeCollaborator = async (id, data) => (await api.delete(`/itineraries/${encodeURIComponent(id)}/collaborators`, { data })).data.data
const history = async (id, params = {}) => (await api.get(`/itineraries/${encodeURIComponent(id)}/history`, { params })).data.data
const restore = async (id, data) => (await api.post(`/itineraries/${encodeURIComponent(id)}/restore`, data)).data.data
const addActivity = async (id, data) => (await api.post(`/itineraries/${encodeURIComponent(id)}/activities`, data)).data.data
const updateActivity = async (id, activityId, data) => (await api.patch(`/itineraries/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}`, data)).data.data
const removeActivity = async (id, activityId, data) => (await api.delete(`/itineraries/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}`, { data })).data.data
const reorderActivities = async (id, data) => (await api.put(`/itineraries/${encodeURIComponent(id)}/activities/order`, data)).data.data
const reorderDays = async (id, data) => (await api.put(`/itineraries/${encodeURIComponent(id)}/days/order`, data)).data.data
const addDay = async (id, data) => (await api.post(`/itineraries/${encodeURIComponent(id)}/days`, data)).data.data
const updateDay = async (id, data) => (await api.patch(`/itineraries/${encodeURIComponent(id)}/days/${encodeURIComponent(data.dayId)}`, data)).data.data
const removeDay = async (id, data) => (await api.delete(`/itineraries/${encodeURIComponent(id)}/days/${encodeURIComponent(data.dayId)}`, { data })).data.data

export default { list, get, generate, update, regenerateDay, duplicate, archive, remove, getShared, setCollaboration, collaborators, grantCollaborator, revokeCollaborator, history, restore, addActivity, updateActivity, removeActivity, reorderActivities, reorderDays, addDay, updateDay, removeDay }
