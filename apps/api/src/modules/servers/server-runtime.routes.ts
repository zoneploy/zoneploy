import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import type { OrgRole, Permission } from '@zoneploy/types'
import { createHmac } from 'node:crypto'
import { WebSocket as WS } from 'ws'
import { and, eq, isNull } from 'drizzle-orm'
import { verifyAccessToken } from '../../lib/jwt.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize, resolvePermissions } from '../../plugins/authorize.js'
import { setSseCorsHeaders } from '../../lib/cors-sse.js'
import { db } from '../../db/client.js'
import { orgMembers, servers } from '../../db/schema.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { getProvisionLogs } from './servers.service.js'
import { buildProvisionLogFlush } from './server-provision-log-stream.js'
import { getAgentAuthToken, getAgentHttpUrl, getAgentWsUrl } from '../../lib/worker-client.js'

async function userHasServerPermission(orgId: string, userId: string, permission: Permission) {
  const [member] = await db
    .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1)

  const permissions = member ? await resolvePermissions(member.role as OrgRole, member.customRoleId) : []
  return permissions.includes(permission)
}

export async function serverRuntimeRoutes(app: FastifyInstance) {
  app.get(
    '/:serverId/provision-logs',
    { preHandler: [authenticate, authorize.permission('servers:read')] },
    async (request, reply) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }

      reply.hijack()
      setSseCorsHeaders(request, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.writeHead(200)
      reply.raw.flushHeaders()

      let interval: ReturnType<typeof setInterval>

      const end = () => {
        clearInterval(interval)
        if (!reply.raw.writableEnded) {
          reply.raw.write('event: done\ndata: {}\n\n')
          reply.raw.end()
        }
      }

      let cursor = 0

      const flush = async () => {
        try {
          const [entries, server] = await Promise.all([
            getProvisionLogs(serverId),
            db
              .select({ status: servers.status, deletedAt: servers.deletedAt })
              .from(servers)
              .where(and(eq(servers.id, serverId), eq(servers.orgId, orgId)))
              .limit(1)
              .then(rows => rows[0] ?? null),
          ])

          const flushState = buildProvisionLogFlush({ entries, cursor, server })
          for (const entry of flushState.newEntries) {
            reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
          }

          cursor = flushState.nextCursor
          if (flushState.shouldEnd) end()
        } catch {
          end()
        }
      }

      await flush()
      interval = setInterval(flush, 800)
      request.raw.on('close', () => clearInterval(interval))
    },
  )

  app.get(
    '/metrics/stream',
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }
      const { token } = request.query as { token?: string }

      if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token is required' } })
      let userId: string
      try {
        const payload = verifyAccessToken(token)
        userId = payload.sub
      } catch {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
      }

      if (!await userHasServerPermission(orgId, userId, 'servers:read')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } })
      }

      setSseCorsHeaders(request, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

      const subscriber = redis.duplicate()
      await subscriber.subscribe(REDIS_KEYS.orgMetricsChannel(orgId))

      subscriber.on('message', (_channel: string, message: string) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${message}\n\n`)
        }
      })

      const keepAlive = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': keep-alive\n\n')
        }
      }, 30_000)

      request.raw.on('close', () => {
        clearInterval(keepAlive)
        try { subscriber.disconnect() } catch {}
      })
    },
  )

  app.get(
    '/:serverId/metrics/live',
    async (request, reply) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }
      const { token } = request.query as { token?: string }

      if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token is required' } })
      let userId: string
      try {
        const payload = verifyAccessToken(token)
        userId = payload.sub
      } catch {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
      }

      if (!await userHasServerPermission(orgId, userId, 'servers:read')) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } })
      }

      const [server] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.orgId, orgId), isNull(servers.deletedAt)))
        .limit(1)

      if (!server) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server not found' } })
      if (server.status !== 'online' && server.agentMode !== 'self_hosted') {
        return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Server is not online' } })
      }

      const agentToken = getAgentAuthToken(server)

      setSseCorsHeaders(request, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

      const abortCtrl = new AbortController()
      request.raw.on('close', () => abortCtrl.abort())

      try {
        const agentRes = await fetch(getAgentHttpUrl(server, '/agent/v1/metrics/stream'), {
          headers: { Authorization: `Bearer ${agentToken}` },
          signal: abortCtrl.signal,
        })

        if (!agentRes.ok || !agentRes.body) {
          reply.raw.write(`data: ${JSON.stringify({ error: 'Could not connect to the agent' })}\n\n`)
          reply.raw.end()
          return
        }

        if (server.agentMode === 'self_hosted' && server.status !== 'online') {
          await db
            .update(servers)
            .set({ status: 'online', lastHeartbeatAt: new Date(), updatedAt: new Date() })
            .where(eq(servers.id, server.id))
            .catch(() => null)
        }

        const reader = agentRes.body.getReader()
        const cleanup = () => reader.cancel().catch(() => null)
        request.raw.on('close', cleanup)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!reply.raw.writableEnded) reply.raw.write(value)
        }
      } catch (error) {
        if (!abortCtrl.signal.aborted && !reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`)
        }
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end()
      }
    },
  )

  app.get(
    '/:serverId/terminal',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }
      const { token, cols, rows } = request.query as { token?: string; cols?: string; rows?: string }

      if (!token) { socket.close(1008, 'Unauthorized'); return }
      let userId: string
      try {
        const payload = verifyAccessToken(token)
        userId = payload.sub
      } catch {
        socket.close(1008, 'Unauthorized')
        return
      }

      if (!await userHasServerPermission(orgId, userId, 'servers:terminal')) {
        socket.close(1008, 'Forbidden')
        return
      }

      const [server] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.orgId, orgId), isNull(servers.deletedAt)))
        .limit(1)

      if (!server || (server.status !== 'online' && server.agentMode !== 'self_hosted')) {
        socket.close(1011, 'Server not available')
        return
      }

      const agentToken = getAgentAuthToken(server)
      const ts = Date.now()
      const hmacPayload = `${server.id}:${ts}`
      const sig = createHmac('sha256', agentToken).update(hmacPayload).digest('hex')
      const hmacToken = `${hmacPayload}:${sig}`

      const agentWs = new WS(
        getAgentWsUrl(server, `/agent/v1/server/terminal?token=${encodeURIComponent(hmacToken)}&cols=${cols ?? '80'}&rows=${rows ?? '24'}`),
      )

      agentWs.on('open', () => {
        agentWs.on('message', (data: Buffer) => {
          if (socket.readyState === socket.OPEN) socket.send(data)
        })
      })

      socket.on('message', (data: Buffer) => {
        if (agentWs.readyState === WS.OPEN) agentWs.send(data)
      })

      agentWs.on('close', () => { if (socket.readyState === socket.OPEN) socket.close() })
      socket.on('close', () => agentWs.close())
      agentWs.on('error', () => { if (socket.readyState === socket.OPEN) socket.close(1011, 'Agent error') })
    },
  )
}
