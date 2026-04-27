import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionContext } from '@zoneploy/types'

interface AuthState {
  authReady: boolean
  accessToken: string | null
  session: SessionContext | null
  tempToken: string | null
  pendingMfa: { type: 'webauthn' | 'totp'; user: { id: string; email: string; fullName: string } } | null
  setSession: (token: string, session: SessionContext) => void
  setPendingMfa: (mfa: AuthState['pendingMfa'], tempToken: string) => void
  clearSession: () => void
  markAuthReady: () => void
  isAuthenticated: () => boolean
}

function sanitizePersistedSession(session: SessionContext | null): SessionContext | null {
  if (!session) return null
  return {
    ...session,
    accessToken: '',
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      authReady: false,
      accessToken: null,
      session: null,
      tempToken: null,
      pendingMfa: null,

      setSession: (accessToken, session) => set({ accessToken, session, tempToken: null, pendingMfa: null, authReady: true }),

      setPendingMfa: (pendingMfa, tempToken) => set({ tempToken, pendingMfa, accessToken: tempToken }),

      clearSession: () => set({ accessToken: null, session: null, tempToken: null, pendingMfa: null, authReady: true }),

      markAuthReady: () => set({ authReady: true }),

      isAuthenticated: () => get().accessToken !== null && !get().pendingMfa,
    }),
    {
      name: 'zoneploy-auth',
      version: 2,
      partialize: state => ({ session: sanitizePersistedSession(state.session) }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as { session?: SessionContext | null }
        return {
          session: sanitizePersistedSession(state.session ?? null),
        }
      },
    },
  ),
)
