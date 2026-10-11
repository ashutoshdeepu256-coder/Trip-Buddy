import { create } from 'zustand'

export const useChatStore = create((set) => ({
  conversations: [],
  setConversations: (update) => set((state) => ({
    conversations: typeof update === 'function' ? update(state.conversations) : update,
  })),
  clear: () => set({ conversations: [] }),
}))
