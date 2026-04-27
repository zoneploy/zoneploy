import type { AuthSessionResponse, SessionContext } from './api.js'
import type { OrgRole } from './enums.js'

export function toSessionContext(data: AuthSessionResponse): SessionContext {
  return {
    accessToken: data.accessToken,
    user: {
      id: data.user.id,
      email: data.user.email,
      fullName: data.user.fullName,
      avatarUrl: data.user.avatarUrl,
      isPlatformAdmin: false,
      emailVerified: data.user.emailVerified,
      totpEnabled: data.user.totpEnabled ?? false,
    },
    org: data.org
      ? {
          id: data.org.id,
          name: data.org.name,
          slug: data.org.slug,
          logoUrl: data.org.logoUrl ?? null,
          role: data.org.role as OrgRole,
          customRoleId: data.org.customRoleId ?? null,
          permissions: data.org.permissions ?? [],
          require2fa: data.org.require2fa ?? false,
        }
      : null,
  }
}
