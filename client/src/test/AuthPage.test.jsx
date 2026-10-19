import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AuthPage from '../pages/AuthPage'
import authService from '../services/authService'
import { useAuthStore } from '../store/authStore'

vi.mock('../services/authService', () => ({
  default: {
    login: vi.fn(),
    register: vi.fn(),
  },
}))

function renderAuthPage(mode = 'login') {
  return render(
    <MemoryRouter initialEntries={[`/${mode}`]}>
      <Routes>
        <Route path={`/${mode}`} element={<AuthPage mode={mode} />} />
        <Route path="/profile" element={<h1>Private profile</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('authentication forms', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, loading: false })
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('uses browser validation and does not submit an empty login form', async () => {
    const user = userEvent.setup()
    renderAuthPage()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByLabelText('Email')).toBeInvalid()
    expect(authService.login).not.toHaveBeenCalled()
  })

  it('shows server errors accessibly and restores the submit button', async () => {
    authService.login.mockRejectedValueOnce({
      response: { data: { error: { message: 'Invalid email or password' } } },
    })
    const user = userEvent.setup()
    renderAuthPage()

    await user.type(screen.getByLabelText('Email'), 'traveler@example.test')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('submits credentials and navigates to the private profile on success', async () => {
    const traveler = { id: 'traveler-1', name: 'A Traveler' }
    authService.login.mockResolvedValueOnce(traveler)
    const user = userEvent.setup()
    renderAuthPage()

    await user.type(screen.getByLabelText('Email'), 'traveler@example.test')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Private profile' })).toBeInTheDocument()
    expect(authService.login).toHaveBeenCalledWith({
      email: 'traveler@example.test',
      password: 'correct-password',
    })
    expect(useAuthStore.getState().user).toEqual(traveler)
  })

  it('exposes the 12-character password requirement during registration', async () => {
    const user = userEvent.setup()
    renderAuthPage('register')

    await user.type(screen.getByLabelText('Name'), 'Alex')
    await user.type(screen.getByLabelText('Email'), 'alex@example.test')
    await user.type(screen.getByLabelText(/Password/), 'short')
    const password = screen.getByLabelText(/Password/)
    expect(password).toHaveAttribute('minlength', '12')
    expect(password).toHaveValue('short')
    expect(authService.register).not.toHaveBeenCalled()
  })
})
