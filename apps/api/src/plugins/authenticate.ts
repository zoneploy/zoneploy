import type { FastifyRequest, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { verifyAccessToken } from '../lib/jwt.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    userEmail: string
    userName: string
    sessionId: string | null
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token is required' } })
  }

  const token = authHeader.slice(7)

  try {
    const payload = verifyAccessToken(token)
    const [user] = await db
      .select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)

    if (!user || user.status !== 'active' || user.deletedAt) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Account is not available' } })
    }

    request.userId = payload.sub
    request.userEmail = payload.email
    request.userName = payload.name ?? ''
    request.sessionId = payload.sid ?? null
  } catch {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}
