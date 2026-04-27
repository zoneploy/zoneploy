import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export interface AccessTokenPayload {
  sub: string        // userId
  email: string
  name?: string      // User fullName for audit logs.
  sid?: string       // session ID (refresh_tokens.id)
  orgId?: string
}

export interface RefreshTokenPayload {
  sub: string        // userId
  jti: string        // Unique token ID for invalidation.
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = {}
  if (config.JWT_ACCESS_EXPIRES_IN) {
    options.expiresIn = config.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn']
  }
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, options)
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: jwt.SignOptions = {}
  if (config.JWT_REFRESH_EXPIRES_IN) {
    options.expiresIn = config.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn']
  }
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, options)
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload
}
