import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../../config.js'

export const REFRESH_TOKEN_COOKIE = 'zp_rt'

function getSiteKey(url: URL): string {
  const hostname = url.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return hostname
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return hostname
  }

  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  return parts.slice(-2).join('.')
}

function isCrossSiteRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const platformUrl = new URL(config.PLATFORM_URL)
    return originUrl.protocol !== platformUrl.protocol || getSiteKey(originUrl) !== getSiteKey(platformUrl)
  } catch {
    return false
  }
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

export function getRefreshCookieOptions(request?: FastifyRequest) {
  const crossSite = request ? isCrossSiteRequest(request) : false
  const sameSite: 'lax' | 'none' = crossSite ? 'none' : 'lax'

  return {
    httpOnly: true,
    secure: crossSite || config.NODE_ENV === 'production',
    sameSite,
    path: '/',
    maxAge: Math.floor(parseDurationMs(config.JWT_REFRESH_EXPIRES_IN) / 1000),
  }
}

export function setRefreshCookie(request: FastifyRequest, reply: FastifyReply, refreshToken: string) {
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, getRefreshCookieOptions(request))
}

export function clearRefreshCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...getRefreshCookieOptions(request),
    maxAge: undefined,
  })
}

export function getRefreshTokenFromRequest(request: FastifyRequest): string | null {
  const cookieToken = request.cookies?.[REFRESH_TOKEN_COOKIE]
  if (typeof cookieToken === 'string' && cookieToken.trim()) return cookieToken

  return null
}

export function toPublicAuthPayload<T extends { refreshToken: string }>(payload: T): Omit<T, 'refreshToken'> {
  const { refreshToken: _refreshToken, ...publicPayload } = payload
  return publicPayload
}
