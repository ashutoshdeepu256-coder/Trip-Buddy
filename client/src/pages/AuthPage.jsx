import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import authService from '../services/authService'
import { useAuthStore } from '../store/authStore'

function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)
  const existingUser = useAuthStore((state) => state.user)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (existingUser) return <Navigate to="/profile" replace />

  const updateField = (event) => {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const user = isRegister
        ? await authService.register(form)
        : await authService.login({ email: form.email, password: form.password })
      setUser(user)
      navigate('/profile')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Unable to complete sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-shell account-shell">
      <div className="account-card">
        <Link to="/" className="brand-wrap">
          <span className="brand-mark">T</span>
          <span>TripBuddy</span>
        </Link>
        <span className="eyebrow">{isRegister ? 'Start your journey' : 'Welcome back'}</span>
        <h1>{isRegister ? 'Create your account' : 'Sign in to TripBuddy'}</h1>
        <p className="muted-copy">
          {isRegister
            ? 'Build your traveler profile and plan trips with confidence.'
            : 'Your travel plans and verification status are waiting.'}
        </p>
        <form className="form-stack" onSubmit={submit}>
          {isRegister && (
            <label>
              Name
              <input name="name" autoComplete="name" value={form.name} onChange={updateField} required minLength={2} maxLength={80} />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" value={form.email} onChange={updateField} required maxLength={254} />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={form.password} onChange={updateField} required minLength={isRegister ? 12 : 1} maxLength={128} />
            {isRegister && <small>Use at least 12 characters.</small>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-btn" type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="account-switch">
          {isRegister ? 'Already have an account?' : 'New to TripBuddy?'}{' '}
          <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </div>
    </main>
  )
}

export default AuthPage
