import { useEffect } from 'react'
import { bootstrapSession } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth'

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const authReady = useAuthStore(s => s.authReady)
  const markAuthReady = useAuthStore(s => s.markAuthReady)

  useEffect(() => {
    let cancelled = false

    bootstrapSession()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) markAuthReady()
      })

    return () => {
      cancelled = true
    }
  }, [markAuthReady])

  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d141d]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    )
  }

  return <>{children}</>
}
