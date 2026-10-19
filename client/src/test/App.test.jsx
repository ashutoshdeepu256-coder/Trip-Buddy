import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import authService from '../services/authService'
import { useAuthStore } from '../store/authStore'

vi.mock('../services/authService', () => ({
  default: {
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
  },
}))

vi.mock('../components/notifications/NotificationBell', () => ({ default: () => null }))
vi.mock('../store/notificationStore', () => ({
  useNotificationStore: (selector) => selector({ start: vi.fn(), stop: vi.fn() }),
}))
vi.mock('../pages/ProfilePage', () => ({ default: () => <h1>Private profile page</h1> }))

describe('application route access', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, loading: false })
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('redirects an unauthenticated visitor from a protected route to sign in', async () => {
    authService.getCurrentUser.mockRejectedValueOnce({ response: { status: 401 } })
    render(<MemoryRouter initialEntries={['/profile']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Sign in to TripBuddy' })).toBeInTheDocument()
  })

  it('renders a protected route after the current session is loaded', async () => {
    authService.getCurrentUser.mockResolvedValueOnce({ id: 'traveler-1', role: 'USER' })
    render(<MemoryRouter initialEntries={['/profile']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Private profile page' })).toBeInTheDocument()
  })
})
