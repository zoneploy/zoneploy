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

function urlsShareSite(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && getSiteKey(left) === getSiteKey(right)
}

function getForwardedProto(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto']
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
  if (proto?.split(',')[0]?.trim()) {
    return proto.split(',')[0]!.trim()
  }

  return request.protocol
}

function getEffectiveRequestUrl(request: FastifyRequest): URL | null {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host
  const firstHost = Array.isArray(host) ? host[0] : host
  if (!firstHost) return null

  try {
    return new URL(`${getForwardedProto(request)}://${firstHost}`)
  } catch {
    return null
  }
}

function isCrossSiteRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const requestUrl = getEffectiveRequestUrl(request)
    if (requestUrl && urlsShareSite(originUrl, requestUrl)) {
      return false
    }

    const appUrl = new URL(config.APP_URL)
    if (urlsShareSite(originUrl, appUrl)) {
      return false
    }

    const platformUrl = new URL(config.PLATFORM_URL)
    return !urlsShareSite(originUrl, platformUrl)
  } catch {
    return false
  }
}

function isHttpsRequest(request?: FastifyRequest): boolean {
  if (!request) return false
  return getForwardedProto(request) === 'https'
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
  const secure = isHttpsRequest(request)
  const sameSite: 'lax' | 'none' = crossSite && secure ? 'none' : 'lax'

  return {
    httpOnly: true,
    secure,
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
