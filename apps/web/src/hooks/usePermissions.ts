import { useAuthStore } from '@/stores/auth'
import type { Permission } from '@zoneploy/types'

/**
 * Returns a `can(permission)` function that verifies whether the current user
 * has the given permission in the active organization.
 *
 * Usage:
 *   const { can } = usePermissions()
 *   const canInvite = can('members:invite')
 */
export function usePermissions() {
  const session = useAuthStore(s => s.session)
  const permissions = session?.org?.permissions ?? []

  function can(permission: Permission): boolean {
    return permissions.includes(permission)
  }

  function canAny(perms: Permission[]): boolean {
    return perms.some(p => permissions.includes(p))
  }

  function canAll(perms: Permission[]): boolean {
    return perms.every(p => permissions.includes(p))
  }

  return { can, canAny, canAll, permissions }
}
