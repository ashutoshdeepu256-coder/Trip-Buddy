import api from './api'

const root = (tripId) => `/expenses/trips/${encodeURIComponent(tripId)}`
const participants = async (tripId) => (await api.get(`${root(tripId)}/participants`)).data.data
const summary = async (tripId) => (await api.get(`${root(tripId)}/summary`)).data.data
const list = async (tripId, params = {}) => (await api.get(root(tripId), { params })).data.data
const get = async (tripId, expenseId) => (await api.get(`${root(tripId)}/${encodeURIComponent(expenseId)}`)).data.data
const create = async (tripId, data, idempotencyKey) => (await api.post(root(tripId), data, { headers: { 'Idempotency-Key': idempotencyKey } })).data.data
const update = async (tripId, expenseId, data) => (await api.patch(`${root(tripId)}/${encodeURIComponent(expenseId)}`, data)).data.data
const voidExpense = async (tripId, expenseId, data) => (await api.post(`${root(tripId)}/${encodeURIComponent(expenseId)}/void`, data)).data.data
const suggestions = async (tripId) => (await api.get(`${root(tripId)}/settlements/suggestions`)).data.data
const settlements = async (tripId, params = {}) => (await api.get(`${root(tripId)}/settlements`, { params })).data.data
const recordSettlement = async (tripId, data, idempotencyKey) => (await api.post(`${root(tripId)}/settlements`, data, { headers: { 'Idempotency-Key': idempotencyKey } })).data.data
const reverseSettlement = async (tripId, settlementId, data) => (await api.post(`${root(tripId)}/settlements/${encodeURIComponent(settlementId)}/reverse`, data)).data.data

export default { participants, summary, list, get, create, update, voidExpense, suggestions, settlements, recordSettlement, reverseSettlement }
