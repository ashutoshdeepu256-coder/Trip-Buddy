import api from './api'

const fetchDestinations = async (params = {}) =>
  (await api.get('/destinations', { params })).data.data

const fetchPopular = async (params = {}) =>
  (await api.get('/destinations/popular', { params })).data.data

const fetchTrending = async (params = {}) =>
  (await api.get('/destinations/trending', { params })).data.data

const fetchNearby = async (params) =>
  (await api.get('/destinations/nearby', { params })).data.data

const fetchSeasonal = async (params = {}) =>
  (await api.get('/destinations/seasonal', { params })).data.data

const fetchBudget = async (params = {}) =>
  (await api.get('/destinations/budget', { params })).data.data

const fetchAdventure = async (params = {}) =>
  (await api.get('/destinations/adventure', { params })).data.data

const fetchDestination = async (idOrSlug) =>
  (await api.get(`/destinations/${encodeURIComponent(idOrSlug)}`)).data.data

export default {
  fetchDestinations,
  fetchPopular,
  fetchTrending,
  fetchNearby,
  fetchSeasonal,
  fetchBudget,
  fetchAdventure,
  fetchDestination,
}
