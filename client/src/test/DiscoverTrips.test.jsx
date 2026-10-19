import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DiscoverTrips from '../pages/trips/DiscoverTrips'
import tripDiscoveryService from '../services/tripDiscoveryService'
import { useTripDiscoveryStore } from '../store/tripDiscoveryStore'

vi.mock('../services/tripDiscoveryService', () => ({
  default: { searchTrips: vi.fn() },
}))
vi.mock('../components/maps/MapPanel', () => ({ default: () => null }))

const emptyResult = {
  items: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
}

function renderDiscovery() {
  return render(<MemoryRouter><DiscoverTrips /></MemoryRouter>)
}

describe('trip discovery states', () => {
  beforeEach(() => {
    useTripDiscoveryStore.setState({
      filters: {},
      results: [],
      pagination: emptyResult,
      loading: false,
      loadingMore: false,
      error: null,
      sort: 'recent',
    })
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('announces loading and then explains an empty search', async () => {
    let finishSearch
    tripDiscoveryService.searchTrips.mockImplementationOnce(() => new Promise((resolve) => {
      finishSearch = resolve
    }))
    renderDiscovery()

    expect(screen.getByRole('region', { name: 'Trip search results' })).toHaveAttribute('aria-busy', 'true')
    finishSearch(emptyResult)

    expect(await screen.findByRole('heading', { name: 'No trips match these filters yet' })).toBeInTheDocument()
  })

  it('shows a recoverable search error and retries from the visible control', async () => {
    tripDiscoveryService.searchTrips
      .mockRejectedValueOnce({ response: { data: { error: { message: 'Search temporarily unavailable' } } } })
      .mockResolvedValueOnce(emptyResult)
    const user = userEvent.setup()
    renderDiscovery()

    expect(await screen.findByRole('alert')).toHaveTextContent('Search temporarily unavailable')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'No trips match these filters yet' })).toBeInTheDocument()
    expect(tripDiscoveryService.searchTrips).toHaveBeenCalledTimes(2)
  })

  it('renders untrusted trip titles as text instead of markup', async () => {
    const title = '<img src=x onerror=alert(1)>'
    tripDiscoveryService.searchTrips.mockResolvedValueOnce({
      ...emptyResult,
      items: [{
        id: 'trip-1',
        title,
        status: 'PUBLISHED',
        startDate: '2030-06-01',
        endDate: '2030-06-07',
        budget: null,
        availableSlots: 2,
        travelStyle: [],
        interests: [],
        creator: { name: 'Traveler', verificationStatus: {} },
        destination: { name: 'Lisbon', country: 'Portugal' },
      }],
      total: 1,
    })
    renderDiscovery()

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(document.querySelector('.discovery-trip-card img')).toBeNull()
  })
})
