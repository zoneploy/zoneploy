import type { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'

const ALLOWED_ORIGINS = new Set([
  config.APP_URL,
  ...(config.EXTRA_CORS_ORIGINS ? config.EXTRA_CORS_ORIGINS.split(',').map(o => o.trim()) : []),
])

/**
 * Adds CORS headers to SSE responses (reply.raw) after validating against
 * the allowed origins list, just like @fastify/cors, but for routes that use
 * reply.hijack() and therefore bypass normal Fastify hooks.
 */
export function setSseCorsHeaders(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin)
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    reply.raw.setHeader('Vary', 'Origin')
  }
}
