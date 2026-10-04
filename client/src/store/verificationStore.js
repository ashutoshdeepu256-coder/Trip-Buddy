import { create } from 'zustand'
import verificationService from '../services/verificationService'

export const useVerificationStore = create((set) => ({
  verificationStatus: null,
  verificationHistory: [],
  loading: false,
  error: null,
  fetchVerificationStatus: async () => {
    set({ loading: true, error: null })
    try {
      const verificationStatus = await verificationService.getVerificationStatus()
      set({ verificationStatus })
      return verificationStatus
    } catch (error) {
      set({ error: error.response?.data?.error?.message || 'Could not load verification status.' })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  fetchVerificationHistory: async () => {
    set({ loading: true, error: null })
    try {
      const verificationHistory = await verificationService.getVerificationHistory()
      set({ verificationHistory })
      return verificationHistory
    } catch (error) {
      set({ error: error.response?.data?.error?.message || 'Could not load verification history.' })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  sendPhoneOTP: (phone) => verificationService.sendPhoneOTP(phone),
  verifyPhoneOTP: (code) => verificationService.verifyPhoneOTP(code),
  submitIdentityVerification: () => verificationService.submitIdentityVerification(),
}))
