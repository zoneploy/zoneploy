import bcrypt from 'bcryptjs'
import { eq, and, ne, gte, desc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../../db/client.js'
import {
  users,
  organizations,
  orgMembers,
  orgInvitations,
  customRoles,
  refreshTokens,
  emailVerificationTokens,
  passkeys,
} from '../../db/schema.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError, InvalidCredentialsError, BadRequestError, ForbiddenError } from '../../lib/errors.js'
import { sendMail, verificationEmail } from '../../lib/mailer.js'
import { config } from '../../config.js'
import type { RegisterInput, LoginInput } from '@zoneploy/types'
import { createNotification } from '../notifications/notifications.service.js'
import { resolvePermissions } from '../../plugins/authorize.js'
import { createOrg } from '../organizations/organizations.service.js'

// Helpers

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

async function createVerificationToken(userId: string): Promise<string> {
  // Delete previous tokens.
  await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId))

  const rawToken = nanoid(48)
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 24) // 24 horas

  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt,
  })

  return rawToken
}

function ensureEmailVerified(emailVerified: boolean) {
  if (!emailVerified) {
    throw new UnauthorizedError('Verificá tu email antes de continuar', 'EMAIL_NOT_VERIFIED')
  }
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

async function hasPendingInvitation(email: string) {
  const [invitation] = await db
    .select({ id: orgInvitations.id })
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.email, email),
        eq(orgInvitations.status, 'pending'),
        gte(orgInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return Boolean(invitation)
}

async function createUserAccount(input: RegisterInput, emailVerified: boolean) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  if (existing) {
    throw new ConflictError('El email ya estÃ¡ registrado')
  }

  const passwordHash = await bcrypt.hash(input.password, 12)

  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      emailVerified,
    })
    .returning()

  if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear usuario')

  createNotification({
    userId: user.id,
    type: 'welcome',
    data: { name: user.fullName, lang: input.lang ?? 'es' },
    link: '/notifications',
  }).catch(err => console.error('Error creando notificaciÃ³n de bienvenida:', err))

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

  const user = await createUserAccount(input, true)
  await createOrg(user.id, 'Zoneploy Workspace')

  return login({ email: input.email, password: input.password }, ctx)
}

export async function register(input: RegisterInput) {
  if (!await ownerConfigured()) {
    throw new BadRequestError('Primero configurÃ¡ el owner de esta instancia self-hosted', 'OWNER_SETUP_REQUIRED')
  }

  if (!await hasPendingInvitation(input.email)) {
    throw new ForbiddenError('El registro pÃºblico estÃ¡ deshabilitado. PedÃ­ una invitaciÃ³n al owner.', 'REGISTRATION_DISABLED')
  }

  // 1. Verificar que el email no exista
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .limit(1)

  if (existing) {
    throw new ConflictError('El email ya está registrado')
  }

  const isBootstrapUser = !existingUser

  // 2. Hash password.
  const passwordHash = await bcrypt.hash(input.password, 12)

  // 3. Create user without an organization.
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      emailVerified: isBootstrapUser,
    })
    .returning()

  if (!user) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear usuario')

  if (isBootstrapUser) {
    await createOrg(user.id, 'Zoneploy Workspace')
  }

  // 4. Send verification email and welcome notification without blocking.
  if (!isBootstrapUser) {
    createVerificationToken(user.id)
    .then(rawToken => {
      const verifyUrl = `${config.APP_URL}/verify-email?token=${rawToken}`
      const mail = verificationEmail({ fullName: user.fullName, verifyUrl, lang: input.lang })
      return sendMail({ to: user.email, ...mail })
    })
    .catch(err => console.error('Error enviando email de verificación:', err))

  }

  createNotification({
    userId: user.id,
    type: 'welcome',
    data: { name: user.fullName, lang: input.lang ?? 'es' },
    link: '/notifications',
  }).catch(err => console.error('Error creando notificación de bienvenida:', err))

  return {
    ok: true,
    requiresEmailVerification: isBootstrapUser ? false : true,
    email: user.email,
  }
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

  if (user.status === 'suspended') {
    throw new UnauthorizedError('Cuenta suspendida')
  }

  // 2. Verify password.
  const valid = await bcrypt.compare(input.password, user.passwordHash)
  if (!valid) {
    throw new InvalidCredentialsError()
  }

  ensureEmailVerified(user.emailVerified)

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
      emailVerified: user.emailVerified,
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

export async function verifyEmail(token: string) {
  const tokenHash = hashToken(token)

  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1)

  if (!record) {
    throw new BadRequestError('Token de verificación inválido o expirado')
  }

  if (record.expiresAt < new Date()) {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, record.id))
    throw new BadRequestError('El token de verificación expiró')
  }

  // Marcar email como verificado
  await db
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, record.userId))

  // Delete the consumed token.
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, record.id))

  return { ok: true }
}

export async function resendVerification(email: string, lang: 'es' | 'en' = 'es') {
  const [user] = await db
    .select({ id: users.id, emailVerified: users.emailVerified, fullName: users.fullName })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user || user.emailVerified) return { ok: true }

  const rawToken = await createVerificationToken(user.id)
  const verifyUrl = `${config.APP_URL}/verify-email?token=${rawToken}`
  const mail = verificationEmail({ fullName: user.fullName, verifyUrl, lang })
  await sendMail({ to: email, ...mail })

  return { ok: true }
}

export async function refresh(token: string) {
  let payload
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw new UnauthorizedError('Refresh token inválido')
  }

  const tokenHash = hashToken(token)
  const [stored] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expirado o revocado')
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      avatarUrl: users.avatarUrl,
      emailVerified: users.emailVerified,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1)

  if (!user || user.status === 'suspended') {
    throw new UnauthorizedError('Cuenta no disponible')
  }

  // Rotar el token in-place: mantiene el mismo sessionId, actualiza hash, lastUsedAt y expiresAt (sliding)
  const jti = nanoid()
  const newRefreshToken = signRefreshToken({ sub: user.id, jti })
  const newAccessToken = signAccessToken({ sub: user.id, email: user.email, name: user.fullName, sid: stored.id })

  const newExpiresAt = new Date(Date.now() + parseDurationMs(config.JWT_REFRESH_EXPIRES_IN))

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
      emailVerified: user.emailVerified,
      totpEnabled: user.totpEnabled,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, require2fa: org.require2fa, role: membership!.role, customRoleId: membership!.customRoleId, permissions }
      : null,
  }
}

export async function logout(token: string) {
  const tokenHash = hashToken(token)
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
}

export async function getPendingInvitations(email: string) {
  return db
    .select({
      id: orgInvitations.id,
      token: orgInvitations.token,
      role: orgInvitations.role,
      customRoleId: orgInvitations.customRoleId,
      customRoleName: customRoles.name,
      expiresAt: orgInvitations.expiresAt,
      orgName: organizations.name,
      invitedByName: users.fullName,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.orgId))
    .innerJoin(users, eq(users.id, orgInvitations.invitedByUserId))
    .leftJoin(customRoles, eq(customRoles.id, orgInvitations.customRoleId))
    .where(
      and(
        eq(orgInvitations.email, email),
        eq(orgInvitations.status, 'pending'),
      ),
    )
    .orderBy(orgInvitations.createdAt)
}

// Used by WebAuthn to generate tokens after passkey authentication.
export async function loginByUserId(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status, fullName: users.fullName, avatarUrl: users.avatarUrl, emailVerified: users.emailVerified, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  if (user.status === 'suspended') throw new UnauthorizedError('Cuenta suspendida')
  ensureEmailVerified(user.emailVerified)

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
      emailVerified: user.emailVerified,
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
  if (!valid) throw new UnauthorizedError('Código TOTP incorrecto')

  return await issueFinalTokens(userId, ctx)
}

// Helper: generates final tokens after MFA verification.
async function issueFinalTokens(userId: string, ctx?: SessionContext) {
  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, avatarUrl: users.avatarUrl, emailVerified: users.emailVerified, totpEnabled: users.totpEnabled })
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
      emailVerified: user.emailVerified,
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
      emailVerified: users.emailVerified,
      isPlatformAdmin: users.isPlatformAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')
  return user
}
