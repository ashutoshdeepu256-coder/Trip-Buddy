import api from './api'

const verificationService = {
  getVerificationStatus: async () => (await api.get('/verifications/me')).data.data,
  getVerificationHistory: async () => (await api.get('/verifications/history')).data.data,
  sendPhoneOTP: async (phone) =>
    (await api.post('/verifications/phone/send-otp', { phone })).data.data,
  verifyPhoneOTP: async (code) =>
    (await api.post('/verifications/phone/verify-otp', { code })).data.data,
  submitIdentityVerification: async () =>
    (await api.post('/verifications/identity')).data.data,
  getIdentityStatus: async () =>
    (await api.get('/verifications/identity/status')).data.data,
  resendEmailVerification: async () =>
    (await api.post('/auth/resend-verification-email')).data.data,
  verifyEmail: async (token) =>
    (await api.post('/auth/verify-email', { token })).data.data,
  uploadIdentityDocument: async (file) => {
    const form = new FormData()
    form.append('document', file)
    return (await api.post('/verifications/identity/document', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data.data
  },
}

export default verificationService
