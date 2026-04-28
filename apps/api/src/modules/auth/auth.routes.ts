import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import type { AuthResponseMfaRequired, AuthSessionResponse } from '@zoneploy/types'
import { RegisterSchema, LoginSchema } from '@zoneploy/types'
import { setupOwner, getSetupStatus, login, loginByUserId, refresh, logout, getMe, completeMfaWebauthn, completeMfaTotp, listSessions, revokeSession, revokeOtherSessions } from './auth.service.js'
import { updateProfile, changePassword, setupTotp, verifyAndEnableTotp, disableTotp, getTotpStatus } from './profile.service.js'
import { getRegistrationOptions, verifyAndSavePasskey, listPasskeys, deletePasskey, getAuthenticationOptions, verifyAuthentication } from './webauthn.service.js'
import { authenticate } from '../../plugins/authenticate.js'
import { AppError } from '../../lib/errors.js'
import { clearRefreshCookie, getRefreshTokenFromRequest, setRefreshCookie, toPublicAuthPayload } from './auth-cookies.js'

function getClientCtx(request: import('fastify').FastifyRequest) {
  const ip =
    (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    (request.headers['x-real-ip'] as string | undefined) ??
    request.ip
  const userAgent = request.headers['user-agent'] ?? null
  return { ip, userAgent }
}

const defaultDeps = {
  setupOwner,
  getSetupStatus,
  login,
  loginByUserId,
  refresh,
  logout,
  getMe,
  completeMfaWebauthn,
  completeMfaTotp,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  updateProfile,
  changePassword,
  setupTotp,
  verifyAndEnableTotp,
  disableTotp,
  getTotpStatus,
  getRegistrationOptions,
  verifyAndSavePasskey,
  listPasskeys,
  deletePasskey,
  getAuthenticationOptions,
  verifyAuthentication,
}

type AuthRouteDeps = typeof defaultDeps
type AuthRoutesOptions = FastifyPluginOptions & {
  deps?: Partial<AuthRouteDeps>
}

type AuthSessionPayload = AuthSessionResponse & {
  refreshToken: string
  requiresMfa?: false
}

function hasRefreshToken(payload: AuthResponseMfaRequired | AuthSessionPayload): payload is AuthSessionPayload {
  return 'refreshToken' in payload
}

function replyWithAuthSession(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, payload: AuthSessionPayload) {
  setRefreshCookie(request, reply, payload.refreshToken)
  return reply.send(toPublicAuthPayload(payload))
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions = {}) {
  const deps: AuthRouteDeps = {
    ...defaultDeps,
    ...(opts.deps ?? {}),
  }

  app.get('/setup-status', async (_request, reply) => {
    return reply.send(await deps.getSetupStatus())
  })

  app.post('/setup-owner', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = RegisterSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
      })
    }

    try {
      const result = await deps.setupOwner(input.data, getClientCtx(request)) as AuthSessionPayload
      return replyWithAuthSession(request, reply, result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /auth/login
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = LoginSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid email or password' },
      })
    }

    try {
      const result = await deps.login(input.data, getClientCtx(request)) as AuthResponseMfaRequired | AuthSessionPayload
      if (!hasRefreshToken(result)) return reply.send(result)
      return replyWithAuthSession(request, reply, result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /auth/refresh
  app.post('/refresh', async (request, reply) => {
    const refreshToken = getRefreshTokenFromRequest(request)

    if (!refreshToken) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Refresh token is required' },
      })
    }

    try {
      const tokens = await deps.refresh(refreshToken)
      return replyWithAuthSession(request, reply, tokens)
    } catch (err) {
      clearRefreshCookie(request, reply)
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/session', async (request, reply) => {
    const refreshToken = getRefreshTokenFromRequest(request)

    if (!refreshToken) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'No active session' },
      })
    }

    try {
      const session = await deps.refresh(refreshToken)
      return replyWithAuthSession(request, reply, session)
    } catch (err) {
      clearRefreshCookie(request, reply)
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /auth/logout
  app.post('/logout', async (request, reply) => {
    const refreshToken = getRefreshTokenFromRequest(request)
    if (refreshToken) {
      await deps.logout(refreshToken).catch(() => null)
    }
    clearRefreshCookie(request, reply)
    return reply.status(204).send()
  })

  // GET /auth/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const user = await deps.getMe(request.userId)
      return reply.send(user)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // GET /auth/profile/2fa/status
  app.get('/profile/2fa/status', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const status = await deps.getTotpStatus(request.userId)
      return reply.send(status)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // PATCH /auth/profile
  app.patch('/profile', { preHandler: [authenticate] }, async (request, reply) => {
    const { fullName } = request.body as { fullName?: string }
    if (!fullName?.trim()) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } })
    try {
      const user = await deps.updateProfile(request.userId, fullName.trim())
      return reply.send(user)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/profile/change-password
  app.post('/profile/change-password', { preHandler: [authenticate] }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body as { currentPassword?: string; newPassword?: string }
    if (!currentPassword || !newPassword) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Required fields are missing' } })
    try {
      const result = await deps.changePassword(request.userId, currentPassword, newPassword)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/profile/2fa/totp/setup
  app.post('/profile/2fa/totp/setup', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const result = await deps.setupTotp(request.userId, request.userEmail)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/profile/2fa/totp/verify
  app.post('/profile/2fa/totp/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const { code } = request.body as { code?: string }
    if (!code) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Code is required' } })
    try {
      const result = await deps.verifyAndEnableTotp(request.userId, code)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/profile/2fa/totp/disable
  app.post('/profile/2fa/totp/disable', { preHandler: [authenticate] }, async (request, reply) => {
    const { code } = request.body as { code?: string }
    if (!code) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Code is required' } })
    try {
      const result = await deps.disableTotp(request.userId, code)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // WebAuthn / Passkeys

  // GET /auth/profile/passkeys: list user passkeys.
  app.get('/profile/passkeys', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const result = await deps.listPasskeys(request.userId)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // DELETE /auth/profile/passkeys/:id: delete passkey.
  app.delete('/profile/passkeys/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const result = await deps.deletePasskey(request.userId, id)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/webauthn/register/options: generate registration options.
  app.post('/webauthn/register/options', { preHandler: [authenticate] }, async (request, reply) => {
    const { attachment } = (request.body ?? {}) as { attachment?: 'platform' | 'cross-platform' }
    try {
      const options = await deps.getRegistrationOptions(request.userId, request.userEmail, request.userEmail, attachment)
      return reply.send(options)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/webauthn/register/verify: verify and save passkey.
  app.post('/webauthn/register/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const { response, deviceName } = request.body as { response?: unknown; deviceName?: string }
    if (!response) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'response is required' } })
    try {
      const result = await deps.verifyAndSavePasskey(request.userId, response as any, deviceName ?? '')
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/webauthn/auth/options: generate authentication options.
  app.post('/webauthn/auth/options', async (request, reply) => {
    const { email } = (request.body ?? {}) as { email?: string }
    try {
      const options = await deps.getAuthenticationOptions(email)
      return reply.send(options)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/webauthn/auth/verify: verify and authenticate with passkey (direct login).
  app.post('/webauthn/auth/verify', async (request, reply) => {
    const { response } = request.body as { response?: unknown }
    if (!response) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'response is required' } })
    try {
      const { userId } = await deps.verifyAuthentication(response as any)
      const tokens = await deps.loginByUserId(userId, getClientCtx(request))
      return replyWithAuthSession(request, reply, tokens)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // MFA (Post-Login)

  // POST /auth/mfa/webauthn/options: get WebAuthn options for MFA.
  app.post('/mfa/webauthn/options', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      // Pass userId to filter user credentials.
      const options = await deps.getAuthenticationOptions(request.userId)
      return reply.send(options)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/mfa/webauthn/verify: complete login with WebAuthn after email/password.
  app.post('/mfa/webauthn/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const { response } = request.body as { response?: unknown }
    if (!response) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'response is required' } })
    try {
      const result = await deps.completeMfaWebauthn(request.userId, response, getClientCtx(request))
      return replyWithAuthSession(request, reply, result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /auth/mfa/totp/verify: complete login with TOTP after email/password.
  app.post('/mfa/totp/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const { code } = request.body as { code?: string }
    if (!code) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'code is required' } })
    try {
      const result = await deps.completeMfaTotp(request.userId, code, getClientCtx(request))
      return replyWithAuthSession(request, reply, result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // Sessions

  // GET /auth/sessions: list active user sessions.
  app.get('/sessions', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const sessions = await deps.listSessions(request.userId, request.sessionId)
      return reply.send(sessions)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // DELETE /auth/sessions/:id: revoke a specific session.
  app.delete('/sessions/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const result = await deps.revokeSession(request.userId, id)
      if (request.sessionId && id === request.sessionId) clearRefreshCookie(request, reply)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // DELETE /auth/sessions: revoke all sessions except the current one.
  app.delete('/sessions', { preHandler: [authenticate] }, async (request, reply) => {
    if (!request.sessionId) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Current session could not be identified' } })
    }
    try {
      const result = await deps.revokeOtherSessions(request.userId, request.sessionId)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
