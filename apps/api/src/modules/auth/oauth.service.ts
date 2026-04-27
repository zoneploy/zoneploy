import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { randomUUID, createHash } from 'node:crypto'
import { db } from '../../db/client.js'
import {
  organizations,
  orgMembers,
  passkeys,
  refreshTokens,
  userAuthIdentities,
  users,
} from '../../db/schema.js'
import { config } from '../../config.js'
import { AppError, NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { signAccessToken, signRefreshToken } from '../../lib/jwt.js'
import { resolvePermissions } from '../../plugins/authorize.js'

export type OAuthProvider = 'google' | 'github'

interface SessionContext {
  ip?: string | null
  userAgent?: string | null
}

interface OAuthIdentity {
  provider: OAuthProvider
  providerUserId: string
  email: string
  emailVerified: boolean
  fullName: string
  avatarUrl: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const n = parseInt(match[1]!, 10)
  switch (match[2]) {
    case 's': return n * 1000
    case 'm': return n * 60 * 1000
    case 'h': return n * 60 * 60 * 1000
    case 'd': return n * 24 * 60 * 60 * 1000
    default: return 7 * 24 * 60 * 60 * 1000
  }
}

function ensureEmailVerified(emailVerified: boolean) {
  if (!emailVerified) {
    throw new UnauthorizedError('Verificá tu email antes de continuar', 'EMAIL_NOT_VERIFIED')
  }
}

function getOAuthCallbackUrl(provider: OAuthProvider) {
  return `${config.APP_URL}/auth/${provider}/callback`
}

function getOAuthProviderCredentials(provider: OAuthProvider) {
  if (provider === 'google') {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new AppError(503, 'OAUTH_PROVIDER_DISABLED', 'Google sign-in is not configured')
    }

    return {
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
    }
  }

  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
    throw new AppError(503, 'OAUTH_PROVIDER_DISABLED', 'GitHub sign-in is not configured')
  }

  return {
    clientId: config.GITHUB_CLIENT_ID,
    clientSecret: config.GITHUB_CLIENT_SECRET,
  }
}

async function issueTokens(userId: string, email: string, name: string, ctx?: SessionContext) {
  const sessionId = randomUUID()
  const jti = nanoid()
  const accessToken = signAccessToken({ sub: userId, email, name, sid: sessionId })
  const refreshToken = signRefreshToken({ sub: userId, jti })

  const expiresAt = new Date(Date.now() + parseDurationMs(config.JWT_REFRESH_EXPIRES_IN))

  await db.insert(refreshTokens).values({
    id: sessionId,
    userId,
    tokenHash: hashToken(refreshToken),
    userAgent: ctx?.userAgent ?? null,
    ipAddress: ctx?.ip ?? null,
    lastUsedAt: new Date(),
    expiresAt,
  })

  return { accessToken, refreshToken, sessionId }
}

async function issueFinalTokens(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      emailVerified: users.emailVerified,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  ensureEmailVerified(user.emailVerified)

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
    .limit(1)

  const [org] = membership
    ? await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          logoUrl: organizations.logoUrl,
          require2fa: organizations.require2fa,
        })
        .from(organizations)
        .where(eq(organizations.id, membership.orgId))
        .limit(1)
    : []

  const tokens = await issueTokens(user.id, user.email, user.fullName, ctx)
  const permissions = membership ? await resolvePermissions(membership.role as any, membership.customRoleId) : []

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logoUrl: org.logoUrl,
          require2fa: org.require2fa,
          role: membership!.role,
          customRoleId: membership!.customRoleId,
          permissions,
        }
      : null,
  }
}

async function beginPrimaryAuth(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
      fullName: users.fullName,
      emailVerified: users.emailVerified,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  if (user.status === 'suspended') throw new UnauthorizedError('Cuenta suspendida')
  ensureEmailVerified(user.emailVerified)

  const [pk] = await db.select().from(passkeys).where(eq(passkeys.userId, user.id)).limit(1)
  const hasPasskeys = !!pk
  const hasTotpEnabled = user.totpEnabled

  if (hasPasskeys || hasTotpEnabled) {
    const tempToken = signAccessToken({ sub: user.id, email: user.email })

    return {
      requiresMfa: true as const,
      mfaType: hasPasskeys ? 'webauthn' as const : 'totp' as const,
      tempToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    }
  }

  return await issueFinalTokens(user.id, ctx)
}

async function resolveOrCreateOAuthUser(identity: OAuthIdentity) {
  if (!identity.emailVerified) {
    throw new UnauthorizedError('La cuenta social debe tener un email verificado', 'OAUTH_EMAIL_NOT_VERIFIED')
  }

  const [existingIdentity] = await db
    .select({ userId: userAuthIdentities.userId })
    .from(userAuthIdentities)
    .where(
      and(
        eq(userAuthIdentities.provider, identity.provider),
        eq(userAuthIdentities.providerUserId, identity.providerUserId),
      ),
    )
    .limit(1)

  let userId = existingIdentity?.userId

  if (!userId) {
    const [existingUser] = await db
      .select({
        id: users.id,
        status: users.status,
        avatarUrl: users.avatarUrl,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1)

    if (existingUser) {
      if (existingUser.status === 'suspended') throw new UnauthorizedError('Cuenta suspendida')
      userId = existingUser.id
    } else {
      const passwordHash = await bcrypt.hash(randomUUID(), 12)
      const [createdUser] = await db
        .insert(users)
        .values({
          email: identity.email,
          passwordHash,
          fullName: identity.fullName,
          avatarUrl: identity.avatarUrl,
          emailVerified: true,
        })
        .returning({ id: users.id })

      if (!createdUser) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear usuario')
      userId = createdUser.id
    }
  }

  await db
    .insert(userAuthIdentities)
    .values({
      userId,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      providerEmail: identity.email,
      providerEmailVerified: identity.emailVerified,
    })
    .onConflictDoUpdate({
      target: [userAuthIdentities.provider, userAuthIdentities.providerUserId],
      set: {
        userId,
        providerEmail: identity.email,
        providerEmailVerified: identity.emailVerified,
        updatedAt: new Date(),
      },
    })

  await db
    .update(users)
    .set({
      emailVerified: true,
      fullName: identity.fullName,
      avatarUrl: identity.avatarUrl,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))

  return userId
}

async function exchangeGoogleCode(code: string): Promise<OAuthIdentity> {
  const { clientId, clientSecret } = getOAuthProviderCredentials('google')
  const redirectUri = getOAuthCallbackUrl('google')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('Google authorization failed', 'OAUTH_EXCHANGE_FAILED')
  }

  const tokenData = await tokenResponse.json() as { access_token?: string }
  if (!tokenData.access_token) {
    throw new UnauthorizedError('Google authorization failed', 'OAUTH_EXCHANGE_FAILED')
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!profileResponse.ok) {
    throw new UnauthorizedError('Google profile lookup failed', 'OAUTH_PROFILE_FAILED')
  }

  const profile = await profileResponse.json() as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }

  if (!profile.sub || !profile.email) {
    throw new UnauthorizedError('Google profile is missing a verified email', 'OAUTH_EMAIL_REQUIRED')
  }

  return {
    provider: 'google',
    providerUserId: profile.sub,
    email: profile.email.toLowerCase(),
    emailVerified: profile.email_verified === true,
    fullName: profile.name?.trim() || profile.email,
    avatarUrl: profile.picture ?? null,
  }
}

async function exchangeGitHubCode(code: string): Promise<OAuthIdentity> {
  const { clientId, clientSecret } = getOAuthProviderCredentials('github')
  const redirectUri = getOAuthCallbackUrl('github')

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('GitHub authorization failed', 'OAUTH_EXCHANGE_FAILED')
  }

  const tokenData = await tokenResponse.json() as { access_token?: string }
  if (!tokenData.access_token) {
    throw new UnauthorizedError('GitHub authorization failed', 'OAUTH_EXCHANGE_FAILED')
  }

  const [profileResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Zoneploy',
      },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Zoneploy',
      },
    }),
  ])

  if (!profileResponse.ok || !emailsResponse.ok) {
    throw new UnauthorizedError('GitHub profile lookup failed', 'OAUTH_PROFILE_FAILED')
  }

  const profile = await profileResponse.json() as {
    id?: number
    name?: string | null
    login?: string | null
    avatar_url?: string | null
  }
  const emails = await emailsResponse.json() as Array<{
    email: string
    primary?: boolean
    verified?: boolean
  }>

  const primaryEmail = emails.find(email => email.primary && email.verified) ?? emails.find(email => email.verified)
  if (!profile.id || !primaryEmail?.email) {
    throw new UnauthorizedError('GitHub account must expose a verified email', 'OAUTH_EMAIL_REQUIRED')
  }

  return {
    provider: 'github',
    providerUserId: String(profile.id),
    email: primaryEmail.email.toLowerCase(),
    emailVerified: primaryEmail.verified === true,
    fullName: profile.name?.trim() || profile.login?.trim() || primaryEmail.email,
    avatarUrl: profile.avatar_url ?? null,
  }
}

async function exchangeOAuthCode(provider: OAuthProvider, code: string) {
  return provider === 'google' ? exchangeGoogleCode(code) : exchangeGitHubCode(code)
}

export function getOAuthAuthorizationUrl(provider: OAuthProvider, state: string) {
  const { clientId } = getOAuthProviderCredentials(provider)
  const redirectUri = getOAuthCallbackUrl(provider)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })

  if (provider === 'google') {
    params.set('scope', 'openid email profile')
    params.set('prompt', 'select_account')
    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    }
  }

  params.set('scope', 'read:user user:email')
  return {
    authorizationUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
  }
}

export async function exchangeOAuthLogin(provider: OAuthProvider, code: string, ctx?: SessionContext) {
  const identity = await exchangeOAuthCode(provider, code)
  const userId = await resolveOrCreateOAuthUser(identity)
  return await beginPrimaryAuth(userId, ctx)
}
