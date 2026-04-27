import bcrypt from 'bcryptjs'
import { eq, and, ne, gte, desc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../../db/client.js'
import {
  users,
  organizations,
  orgMembers,
  refreshTokens,
  passkeys,
} from '../../db/schema.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, InvalidCredentialsError } from '../../lib/errors.js'
import { config } from '../../config.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import type { RegisterInput, LoginInput } from '@zoneploy/types'
import { createNotification } from '../notifications/notifications.service.js'
import { resolvePermissions } from '../../plugins/authorize.js'
import { createOrg } from '../organizations/organizations.service.js'

// Helpers

type RefreshTokenRecord = typeof refreshTokens.$inferSelect

const REFRESH_TOKEN_ROTATION_GRACE_SECONDS = 120

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Converts a JWT duration string ("15m", "7d", "1h") to milliseconds. */
function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const n = parseInt(match[1]!, 10)
  switch (match[2]) {
    case 's': return n * 1000
    case 'm': return n * 60 * 1000
    case 'h': return n * 60 * 60 * 1000
    case 'd': return n * 24 * 60 * 60 * 1000
    default:  return 7 * 24 * 60 * 60 * 1000
  }
}

interface SessionContext {
  ip?: string | null
  userAgent?: string | null
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

async function findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
  const [stored] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  return stored
}

async function findRefreshTokenByGrace(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
  const sessionId = await redis
    .get(REDIS_KEYS.refreshTokenGrace(tokenHash))
    .catch(() => null)

  if (!sessionId) return undefined

  const [stored] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.id, sessionId))
    .limit(1)

  return stored
}

async function rememberRefreshTokenGrace(tokenHash: string, sessionId: string) {
  await redis
    .set(REDIS_KEYS.refreshTokenGrace(tokenHash), sessionId, 'EX', REFRESH_TOKEN_ROTATION_GRACE_SECONDS)
    .catch(() => null)
}

// Services

async function ownerConfigured() {
  const [owner] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(eq(orgMembers.role, 'owner'))
    .limit(1)

  return Boolean(owner)
}

async function createUserAccount(input: RegisterInput) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (existing) {
    throw new ConflictError('El email ya estÃƒÂ¡ registrado')
  }

  const passwordHash = await bcrypt.hash(input.password, 12)

  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
    })
    .returning()

  if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear usuario')

  createNotification({
    userId: user.id,
    type: 'welcome',
    data: { name: user.fullName, lang: input.lang ?? 'es' },
    link: '/notifications',
  }).catch(err => console.error('Error creando notificaciÃƒÂ³n de bienvenida:', err))

  return user
}

export async function getSetupStatus() {
  const configured = await ownerConfigured()
  return {
    ownerConfigured: configured,
    requiresOwnerSetup: !configured,
  }
}

export async function setupOwner(input: RegisterInput, ctx?: SessionContext) {
  if (await ownerConfigured()) {
    throw new ConflictError('La instancia ya tiene un owner configurado', 'OWNER_ALREADY_CONFIGURED')
  }

  const user = await createUserAccount(input)
  await createOrg(user.id, 'Zoneploy Workspace')

  return login({ email: input.email, password: input.password }, ctx)
}

export async function login(input: LoginInput, ctx?: SessionContext) {
  // 1. Find the user.
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (!user) {
    throw new InvalidCredentialsError()
  }

  if (user.status === 'suspended' || user.deletedAt) {
    throw new UnauthorizedError('Cuenta suspendida')
  }

  // 2. Verify password.
  const valid = await bcrypt.compare(input.password, user.passwordHash)
  if (!valid) {
    throw new InvalidCredentialsError()
  }


  // 3. Check MFA hierarchy: Passkeys > TOTP.
  const [pk] = await db.select().from(passkeys).where(eq(passkeys.userId, user.id)).limit(1)
  const hasPasskeys = !!pk
  const hasTotpEnabled = user.totpEnabled

  if (hasPasskeys || hasTotpEnabled) {
    // User requires MFA; generate a short-lived tempToken.
    const tempToken = signAccessToken({ sub: user.id, email: user.email })

    return {
      requiresMfa: true,
      mfaType: hasPasskeys ? 'webauthn' : 'totp',
      tempToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    }
  }

  // 4. No MFA; verify org restrictions and generate final tokens.
  const [membership] = await db
    .select({
      orgId: orgMembers.orgId,
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
    })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
    .limit(1)

  const [org] = membership
    ? await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, logoUrl: organizations.logoUrl, require2fa: organizations.require2fa })
        .from(organizations)
        .where(eq(organizations.id, membership.orgId))
        .limit(1)
    : []

  const tokens = await issueTokens(user.id, user.email, user.fullName, ctx)
  const permissions = membership ? await resolvePermissions(membership.role as any, membership.customRoleId) : []

  return {
    ...tokens,
    requiresMfa: false,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

export async function refresh(token: string) {
  let payload
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw new UnauthorizedError('Refresh token invÃ¡lido')
  }

  const tokenHash = hashToken(token)
  const stored = await findRefreshTokenByHash(tokenHash) ?? await findRefreshTokenByGrace(tokenHash)

  if (!stored || stored.userId !== payload.sub || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expirado o revocado')
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      deletedAt: users.deletedAt,
      avatarUrl: users.avatarUrl,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1)

  if (!user || user.status === 'suspended' || user.deletedAt) {
    throw new UnauthorizedError('Cuenta no disponible')
  }

  // Rotar el token in-place: mantiene el mismo sessionId, actualiza hash, lastUsedAt y expiresAt (sliding)
  const jti = nanoid()
  const newRefreshToken = signRefreshToken({ sub: user.id, jti })
  const newAccessToken = signAccessToken({ sub: user.id, email: user.email, name: user.fullName, sid: stored.id })

  const newExpiresAt = new Date(Date.now() + parseDurationMs(config.JWT_REFRESH_EXPIRES_IN))

  await rememberRefreshTokenGrace(stored.tokenHash, stored.id)

  await db
    .update(refreshTokens)
    .set({ tokenHash: hashToken(newRefreshToken), lastUsedAt: new Date(), expiresAt: newExpiresAt })
    .where(eq(refreshTokens.id, stored.id))

  // Return fresh user and org data so the client can update its session.
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
    .limit(1)

  const [org] = membership
    ? await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, logoUrl: organizations.logoUrl, require2fa: organizations.require2fa })
        .from(organizations)
        .where(eq(organizations.id, membership.orgId))
        .limit(1)
    : []

  const permissions = membership ? await resolvePermissions(membership.role as any, membership.customRoleId) : []

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

export async function logout(token: string) {
  const tokenHash = hashToken(token)
  const stored = await findRefreshTokenByHash(tokenHash) ?? await findRefreshTokenByGrace(tokenHash)

  if (stored) {
    await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id))
    await redis.del(REDIS_KEYS.refreshTokenGrace(tokenHash), REDIS_KEYS.refreshTokenGrace(stored.tokenHash)).catch(() => null)
    return
  }

  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
  await redis.del(REDIS_KEYS.refreshTokenGrace(tokenHash)).catch(() => null)
}

// Used by WebAuthn to generate tokens after passkey authentication.
export async function loginByUserId(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status, deletedAt: users.deletedAt, fullName: users.fullName, avatarUrl: users.avatarUrl, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  if (user.status === 'suspended' || user.deletedAt) throw new UnauthorizedError('Cuenta suspendida')

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
    .limit(1)

  const [org] = membership
    ? await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, logoUrl: organizations.logoUrl, require2fa: organizations.require2fa })
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
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

// Session management

export async function listSessions(userId: string, currentSessionId?: string | null) {
  const sessions = await db
    .select({
      id: refreshTokens.id,
      userAgent: refreshTokens.userAgent,
      ipAddress: refreshTokens.ipAddress,
      lastUsedAt: refreshTokens.lastUsedAt,
      createdAt: refreshTokens.createdAt,
    })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        gte(refreshTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(refreshTokens.lastUsedAt))

  return sessions.map(s => ({
    ...s,
    isCurrent: s.id === currentSessionId,
  }))
}

export async function revokeSession(userId: string, sessionId: string) {
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.id, sessionId), eq(refreshTokens.userId, userId)))
  return { ok: true }
}

export async function revokeOtherSessions(userId: string, currentSessionId: string) {
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), ne(refreshTokens.id, currentSessionId)))
  return { ok: true }
}

// Complete MFA with WebAuthn (passkey).
export async function completeMfaWebauthn(userId: string, response: unknown, ctx?: SessionContext) {
  const { verifyAuthentication } = await import('./webauthn.service.js')
  await verifyAuthentication(response as any)
  return await issueFinalTokens(userId, ctx)
}

// Complete MFA with TOTP.
export async function completeMfaTotp(userId: string, code: string, ctx?: SessionContext) {
  const { verifySync } = await import('otplib')
  const [user] = await db
    .select({ totpSecret: users.totpSecret })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.totpSecret) throw new UnauthorizedError('TOTP no configurado')
  const valid = verifySync({ token: code, secret: user.totpSecret, strategy: 'totp' })
  if (!valid) throw new UnauthorizedError('CÃ³digo TOTP incorrecto')

  return await issueFinalTokens(userId, ctx)
}

// Helper: generates final tokens after MFA verification.
async function issueFinalTokens(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status, deletedAt: users.deletedAt, fullName: users.fullName, avatarUrl: users.avatarUrl, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  if (user.status === 'suspended' || user.deletedAt) throw new UnauthorizedError('Cuenta suspendida')

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
    .limit(1)

  const [org] = membership
    ? await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, logoUrl: organizations.logoUrl, require2fa: organizations.require2fa })
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
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

export async function getMe(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      status: users.status,
      isPlatformAdmin: users.isPlatformAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  return user
}
