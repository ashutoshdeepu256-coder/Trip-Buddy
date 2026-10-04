import { useEffect, useState } from 'react'
import verificationService from '../services/verificationService'
import OTPVerificationForm from './OTPVerificationForm'

function PhoneVerificationForm({ onVerified }) {
  const [phone, setPhone] = useState('')
  const [resendSeconds, setResendSeconds] = useState(0)
  const [developmentCode, setDevelopmentCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!resendSeconds) return undefined
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  const sendCode = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setSending(true)
    try {
      const result = await verificationService.sendPhoneOTP(phone)
      setResendSeconds(result.resendAfterSeconds || 60)
      setDevelopmentCode(result.developmentCode || '')
      setMessage('A verification code was sent to your phone.')
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not send a verification code.')
    } finally {
      setSending(false)
    }
  }

  const verifyCode = async (code) => {
    setError('')
    setMessage('')
    try {
      await verificationService.verifyPhoneOTP(code)
      setMessage('Your phone number is verified.')
      setDevelopmentCode('')
      onVerified()
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Could not verify this code.')
    }
  }

  return (
    <div className="verification-flow">
      <form className="form-stack compact-form" onSubmit={sendCode}>
        <label>
          Phone number
          <input
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+14155552671"
            required
            minLength={8}
            maxLength={30}
          />
          <small>Use international format, for example +14155552671.</small>
        </label>
        <button type="submit" className="secondary-btn" disabled={sending || resendSeconds > 0}>
          {sending ? 'Sending…' : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Send verification code'}
        </button>
      </form>
      <OTPVerificationForm onVerify={verifyCode} />
      {developmentCode && <p className="dev-code" role="status">Development code: <strong>{developmentCode}</strong></p>}
      {message && <p className="form-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted-copy">Codes expire after five minutes. Attempts are limited.</p>
    </div>
  )
}

export default PhoneVerificationForm
