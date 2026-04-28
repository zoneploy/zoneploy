import type { FastifyInstance, FastifyReply } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { createHmac } from 'node:crypto'
import { WebSocket as WS } from 'ws'
import { eq, and } from 'drizzle-orm'
import { CreateContainerSchema, UpdateContainerSchema, PaginationSchema } from '@zoneploy/types'
import type { OrgRole, Permission } from '@zoneploy/types'
import { authenticate as defaultAuthenticate } from '../../plugins/authenticate.js'
import { authorize as defaultAuthorize, resolvePermissions } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit as defaultAudit } from '../../lib/audit.js'
import { setSseCorsHeaders } from '../../lib/cors-sse.js'
import { verifyAccessToken } from '../../lib/jwt.js'
import { db } from '../../db/client.js'
import { containerDeployments, containers, servers, orgMembers } from '../../db/schema.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { getAgentAuthToken, getAgentHttpUrl, getAgentWsUrl } from '../../lib/worker-client.js'
import {
  listContainers,
  getContainer,
  createContainer,
  updateContainer,
  deleteContainer,
  deployContainer,
  listDeployments,
  getDeployment,
  rollbackDeployment,
  getCurrentMetrics,
  getContainerForStreaming,
  regenerateDeployToken,
  revokeDeployToken,
  startContainer,
  stopContainer,
  restartContainer,
  inspectContainer,
  getMetricsHistory,
} from './containers.service.js'

interface ContainerRouteDeps {
  authenticate?: typeof defaultAuthenticate
  authorize?: typeof defaultAuthorize
  audit?: typeof defaultAudit
  listContainers?: typeof listContainers
  getContainer?: typeof getContainer
  createContainer?: typeof createContainer
  updateContainer?: typeof updateContainer
  deleteContainer?: typeof deleteContainer
  deployContainer?: typeof deployContainer
  listDeployments?: typeof listDeployments
  getDeployment?: typeof getDeployment
  rollbackDeployment?: typeof rollbackDeployment
  getCurrentMetrics?: typeof getCurrentMetrics
  regenerateDeployToken?: typeof regenerateDeployToken
  revokeDeployToken?: typeof revokeDeployToken
  startContainer?: typeof startContainer
  stopContainer?: typeof stopContainer
  restartContainer?: typeof restartContainer
  inspectContainer?: typeof inspectContainer
  getMetricsHistory?: typeof getMetricsHistory
}

function handleContainerRouteError(reply: FastifyReply, err: unknown) {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

export async function containerRoutes(app: FastifyInstance, options: { deps?: ContainerRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    audit: defaultAudit,
    listContainers,
    getContainer,
    createContainer,
    updateContainer,
    deleteContainer,
    deployContainer,
    listDeployments,
    getDeployment,
    rollbackDeployment,
    getCurrentMetrics,
    regenerateDeployToken,
    revokeDeployToken,
    startContainer,
    stopContainer,
    restartContainer,
    inspectContainer,
    getMetricsHistory,
    ...options.deps,
  }
  const allow = (permission: Permission, fallbackRole: Parameters<typeof defaultAuthorize>[0]) =>
    deps.authorize.permission?.(permission) ?? deps.authorize(fallbackRole)

  // GET /organizations/:orgId/containers
  app.get('/', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }
    try {
      return reply.send(await deps.listContainers(orgId))
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // GET /organizations/:orgId/containers/:cid
  app.get('/:containerId', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.getContainer(orgId, containerId))
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers
  app.post('/', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }
    const input = CreateContainerSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' } })
    }
    try {
      const result = await deps.createContainer(orgId, input.data)
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'container.created', resourceType: 'container', resourceId: result.id, resourceName: result.name, ipAddress: req.ip })
      return reply.status(201).send(result)
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // PATCH /organizations/:orgId/containers/:cid
  app.patch('/:containerId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const input = UpdateContainerSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' } })
    }
    try {
      const result = await deps.updateContainer(orgId, containerId, input.data)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'container.updated',
        resourceType: 'container',
        resourceId: containerId,
        resourceName: result.name,
        metadata: input.data,
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // DELETE /organizations/:orgId/containers/:cid
  app.delete('/:containerId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      await deps.deleteContainer(orgId, containerId, req.userId)
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'container.deleted', resourceType: 'container', resourceId: containerId, resourceName: container.name, ipAddress: req.ip })
      return reply.status(204).send()
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/deploy
  app.post('/:containerId/deploy', { preHandler: [deps.authenticate, allow('containers:deploy', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const [result, container] = await Promise.all([
        deps.deployContainer(orgId, containerId, req.userId),
        deps.getContainer(orgId, containerId),
      ])
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'container.deployed', resourceType: 'container', resourceId: containerId, resourceName: container.name, ipAddress: req.ip })
      return reply.status(202).send(result)
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // GET /organizations/:orgId/containers/:cid/deployments
  app.get('/:containerId/deployments', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const { page, limit } = PaginationSchema.parse(req.query)
    try {
      return reply.send(await deps.listDeployments(orgId, containerId, page, limit))
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // GET /organizations/:orgId/containers/:cid/deployments/:did
  app.get('/:containerId/deployments/:deploymentId', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, deploymentId } = req.params as { orgId: string; containerId: string; deploymentId: string }
    try {
      return reply.send(await deps.getDeployment(orgId, deploymentId))
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/deployments/:did/rollback
  app.post('/:containerId/deployments/:deploymentId/rollback', { preHandler: [deps.authenticate, allow('containers:deploy', 'member')] }, async (req, reply) => {
    const { orgId, containerId, deploymentId } = req.params as { orgId: string; containerId: string; deploymentId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      const result = await deps.rollbackDeployment(orgId, containerId, deploymentId, req.userId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'container.deployed',
        resourceType: 'container',
        resourceId: containerId,
        resourceName: container.name,
        metadata: { rollback: true, deploymentId },
        ipAddress: req.ip,
      })
      return reply.status(202).send(result)
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/start
  app.post('/:containerId/start', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      await deps.startContainer(orgId, containerId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'container.started',
        resourceType: 'container',
        resourceId: containerId,
        resourceName: container.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/stop
  app.post('/:containerId/stop', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      await deps.stopContainer(orgId, containerId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'container.stopped',
        resourceType: 'container',
        resourceId: containerId,
        resourceName: container.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/restart
  app.post('/:containerId/restart', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      await deps.restartContainer(orgId, containerId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'container.restarted',
        resourceType: 'container',
        resourceId: containerId,
        resourceName: container.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // GET /organizations/:orgId/containers/:cid/inspect
  app.get('/:containerId/inspect', { preHandler: [deps.authenticate, allow('containers:terminal', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.inspectContainer(orgId, containerId))
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // POST /organizations/:orgId/containers/:cid/deploy-token
  // Genera (o regenera) el deploy token. Devuelve el token en claro UNA SOLA VEZ.
  app.post('/:containerId/deploy-token', { preHandler: [deps.authenticate, allow('containers:deploy', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      const result = await deps.regenerateDeployToken(orgId, containerId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'deploy_token.created',
        resourceType: 'deploy_token',
        resourceId: containerId,
        resourceName: container.name,
        metadata: { ownerType: 'container', ownerId: containerId },
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // DELETE /organizations/:orgId/containers/:cid/deploy-token
  app.delete('/:containerId/deploy-token', { preHandler: [deps.authenticate, allow('containers:deploy', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const container = await deps.getContainer(orgId, containerId)
      await deps.revokeDeployToken(orgId, containerId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'deploy_token.deleted',
        resourceType: 'deploy_token',
        resourceId: containerId,
        resourceName: container.name,
        metadata: { ownerType: 'container', ownerId: containerId },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleContainerRouteError(reply, err)
    }
  })

  // GET /organizations/:orgId/containers/:cid/files: list files
  app.get('/:containerId/files', { preHandler: [deps.authenticate, allow('containers:terminal', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const { path = '/' } = req.query as { path?: string }

    if (!path.startsWith('/')) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } })
    }

    try {
      const { container, server } = await getContainerForStreaming(orgId, containerId)
      const agentToken = getAgentAuthToken(server)
      const agentUrl = getAgentHttpUrl(server, `/agent/v1/containers/${container.dockerId}/files?path=${encodeURIComponent(path)}`)
      const agentRes = await fetch(agentUrl, {
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: AbortSignal.timeout(30_000),
      })
      const data = await agentRes.json()
      return reply.status(agentRes.status).send(data)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // GET /organizations/:orgId/containers/:cid/metrics/current
  app.get('/:containerId/metrics/current', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      const metrics = await deps.getCurrentMetrics(orgId, containerId)
      return reply.send(metrics ?? { message: 'No metrics yet' })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // GET /organizations/:orgId/containers/:cid/metrics/live (SSE proxy)
  // Live container metrics stream directly from the agent, every ~2s.
  // Active only while the user has the container page open.
  // Auth: JWT en query param ?token= (EventSource no soporta headers).
  app.get('/:containerId/metrics/live', async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const { token } = req.query as { token?: string }

    if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token is required' } })
    try {
      verifyAccessToken(token)
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    }

    const [container] = await db
      .select()
      .from(containers)
      .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId)))
      .limit(1)

    if (!container?.dockerId || !container.serverId) {
      return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Container no disponible' } })
    }

    const [server] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, container.serverId))
      .limit(1)

    if (!server || (server.status !== 'online' && server.agentMode !== 'self_hosted')) {
      return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Server is not available' } })
    }

    const agentToken = getAgentAuthToken(server)

    setSseCorsHeaders(req, reply)
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    const abortCtrl = new AbortController()
    req.raw.on('close', () => abortCtrl.abort())

    try {
      const agentRes = await fetch(
        getAgentHttpUrl(server, `/agent/v1/containers/${container.dockerId}/metrics/stream`),
        { headers: { Authorization: `Bearer ${agentToken}` }, signal: abortCtrl.signal },
      )

      if (!agentRes.ok || !agentRes.body) {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Could not connect to the agent' })}\n\n`)
        }
        reply.raw.end()
        return
      }

      const reader = agentRes.body.getReader()
      req.raw.on('close', () => reader.cancel().catch(() => null))

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!reply.raw.writableEnded) reply.raw.write(value)
      }
    } catch (err) {
      if (!abortCtrl.signal.aborted && !reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`)
      }
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })

  // GET /organizations/:orgId/containers/:cid/metrics/history
  app.get('/:containerId/metrics/history', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const { period = '1h' } = req.query as { period?: string }
    const validPeriods = ['1h', '6h', '24h'] as const
    const safePeriod = validPeriods.includes(period as typeof validPeriods[number])
      ? (period as typeof validPeriods[number])
      : '1h'
    try {
      const data = await deps.getMetricsHistory(orgId, containerId, safePeriod)
      return reply.send(data)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // GET /organizations/:orgId/containers/:cid/deployments/:did/stream (SSE)
  // Streams deploy steps in real time through Redis pub/sub.
  // Supports both active deploys and reading past deploy history.
  app.get('/:containerId/deployments/:deploymentId/stream', { preHandler: [deps.authenticate, allow('containers:deploy', 'member')] }, async (req, reply) => {
    const { orgId, containerId, deploymentId } = req.params as {
      orgId: string
      containerId: string
      deploymentId: string
    }

    // Verify that the deployment belongs to this organization and container.
    const [deployment] = await db
      .select({ id: containerDeployments.id, status: containerDeployments.status, containerId: containerDeployments.containerId })
      .from(containerDeployments)
      .where(and(eq(containerDeployments.id, deploymentId), eq(containerDeployments.orgId, orgId)))
      .limit(1)

    if (!deployment || deployment.containerId !== containerId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deployment not found' } })
    }

    setSseCorsHeaders(req, reply)
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    // Send existing logs first.
    const existing = await redis.lrange(REDIS_KEYS.deployLogs(deploymentId), 0, -1)
    for (const entry of existing) {
      reply.raw.write(`data: ${entry}\n\n`)
    }

    // If deploy already finished, close immediately.
    const isFinished = deployment.status === 'success' || deployment.status === 'failed'
    if (isFinished) {
      reply.raw.write('event: done\ndata: {}\n\n')
      reply.raw.end()
      return
    }

    // Subscribe to new logs through pub/sub while the deployment is still running.
    const subscriber = redis.duplicate()
    await subscriber.subscribe(REDIS_KEYS.deployLogsChannel(deploymentId))

    subscriber.on('message', (_channel: string, message: string) => {
      reply.raw.write(`data: ${message}\n\n`)

      // If the log has done:true, close the connection.
      try {
        const parsed = JSON.parse(message) as { done?: boolean }
        if (parsed.done) {
          reply.raw.write('event: done\ndata: {}\n\n')
          reply.raw.end()
          subscriber.disconnect()
        }
      } catch {
        // ignorar errores de parse
      }
    })

    req.raw.on('close', () => { try { subscriber.disconnect() } catch { /* ignore */ } })
  })

  // GET /organizations/:orgId/containers/:cid/logs (SSE)
  // Proxies the agent SSE stream to the client. Nothing is stored in DB.
  app.get('/:containerId/logs', { preHandler: [deps.authenticate, allow('containers:terminal', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const { tail = '200' } = req.query as { tail?: string }

    try {
      const { container, server } = await getContainerForStreaming(orgId, containerId)
      const agentToken = getAgentAuthToken(server)

      const agentUrl = getAgentHttpUrl(server, `/agent/v1/containers/${containerId}/logs?tail=${tail}`)
      const agentRes = await fetch(agentUrl, {
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: AbortSignal.timeout(300_000), // 5 min maximum.
      })

      if (!agentRes.ok || !agentRes.body) {
        return reply.status(502).send({ error: { code: 'AGENT_ERROR', message: 'Could not connect to the agent' } })
      }

      setSseCorsHeaders(req, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

      // Pipe the agent stream to the client.
      const reader = agentRes.body.getReader()
      const decoder = new TextDecoder()

      const cleanup = () => reader.cancel().catch(() => null)
      req.raw.on('close', cleanup)

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          reply.raw.write(decoder.decode(value, { stream: true }))
        }
      } finally {
        reply.raw.end()
      }
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // GET /organizations/:orgId/containers/:cid/terminal (WebSocket proxy)
  // The browser connects through WSS to the control plane, which proxies WS to the VPS agent.
  // Auth: user JWT in query param ?token=<access_token>.
  app.get(
    '/:containerId/terminal',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const { orgId, containerId } = request.params as { orgId: string; containerId: string }
      const { token } = request.query as { token?: string }

      // Validate user JWT.
      if (!token) { socket.close(1008, 'Unauthorized'); return }
      let userId: string
      try {
        const payload = verifyAccessToken(token)
        userId = payload.sub
      } catch {
        socket.close(1008, 'Unauthorized')
        return
      }

      // Verify organization membership and terminal permission.
      const [member] = await db
        .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
        .limit(1)

      const permissions = member ? await resolvePermissions(member.role as OrgRole, member.customRoleId) : []
      if (!permissions.includes('containers:terminal')) {
        socket.close(1008, 'Forbidden')
        return
      }

      // Resolve the target container and server before opening the agent tunnel.
      let serverData: {
        ipAddress: string
        agentPort: number
        agentMode: 'legacy' | 'self_hosted'
        agentTokenEncrypted: string
        agentTokenIv: string
        agentTokenAuthTag: string
      }
      try {
        const { server } = await getContainerForStreaming(orgId, containerId)
        serverData = server
      } catch {
        socket.close(1011, 'Container not available')
        return
      }

      // Generate HMAC token for the agent.
      const agentToken = getAgentAuthToken(serverData)
      const ts = Date.now()
      const hmacPayload = `${containerId}:${ts}`
      const sig = createHmac('sha256', agentToken).update(hmacPayload).digest('hex')
      const hmacToken = `${hmacPayload}:${sig}`

      // Connect to the agent through internal WS.
      const agentWs = new WS(
        getAgentWsUrl(serverData, `/agent/v1/containers/${containerId}/terminal?token=${encodeURIComponent(hmacToken)}`),
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
