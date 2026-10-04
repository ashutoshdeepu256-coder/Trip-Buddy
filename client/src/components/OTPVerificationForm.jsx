import { useState } from 'react'

function OTPVerificationForm({ onVerify }) {
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setVerifying(true)
    try {
      await onVerify(code)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <form className="form-stack compact-form" onSubmit={submit}>
      <label>
        Six-digit code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          pattern="\d{6}"
          required
          minLength={6}
          maxLength={6}
        />
      </label>
      <button type="submit" className="primary-btn" disabled={verifying || code.length !== 6}>
        {verifying ? 'Checking…' : 'Verify phone'}
      </button>
    </form>
  )
}

export default OTPVerificationForm
