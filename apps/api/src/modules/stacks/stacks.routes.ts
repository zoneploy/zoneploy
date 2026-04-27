import type { FastifyInstance, FastifyReply } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { createHmac } from 'node:crypto'
import { WebSocket as WS } from 'ws'
import { z } from 'zod'
import { CreateStackSchema, UpdateStackSchema, UpsertSecretSchema } from '@zoneploy/types'
import type { OrgRole, Permission } from '@zoneploy/types'
import { authenticate as defaultAuthenticate } from '../../plugins/authenticate.js'
import { authorize as defaultAuthorize, resolvePermissions } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit as defaultAudit } from '../../lib/audit.js'
import { setSseCorsHeaders } from '../../lib/cors-sse.js'
import { decrypt } from '../../lib/crypto.js'
import { verifyAccessToken } from '../../lib/jwt.js'
import { db } from '../../db/client.js'
import { orgMembers } from '../../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { stackDomainRoutes } from './stack-domains.routes.js'
import {
  listStacks,
  getStack,
  listStackDeployments,
  createStack,
  updateStack,
  deleteStack,
  deployStack,
  regenerateStackDeployToken,
  revokeStackDeployToken,
  listStackSecrets,
  upsertStackSecret,
  deleteStackSecret,
  getStackForStreaming,
  listStackServices,
  startStack,
  stopStack,
  restartStack,
  listStackBackups,
  getStackBackupPolicy,
  updateStackBackupPolicy,
  createStackBackup,
  restoreStackBackup,
  deleteStackBackup,
  startStackService,
  stopStackService,
  restartStackService,
  inspectStackService,
  listStackServiceFiles,
  getCurrentStackServiceMetrics,
  getStackServiceMetricsHistory,
} from './stacks.service.js'
import { getAgentHttpUrl, getAgentWsUrl } from '../../lib/worker-client.js'

interface StackRouteDeps {
  authenticate?: typeof defaultAuthenticate
  authorize?: typeof defaultAuthorize
  audit?: typeof defaultAudit
  listStacks?: typeof listStacks
  getStack?: typeof getStack
  listStackDeployments?: typeof listStackDeployments
  createStack?: typeof createStack
  updateStack?: typeof updateStack
  deleteStack?: typeof deleteStack
  deployStack?: typeof deployStack
  regenerateStackDeployToken?: typeof regenerateStackDeployToken
  revokeStackDeployToken?: typeof revokeStackDeployToken
  listStackSecrets?: typeof listStackSecrets
  upsertStackSecret?: typeof upsertStackSecret
  deleteStackSecret?: typeof deleteStackSecret
  listStackServices?: typeof listStackServices
  startStack?: typeof startStack
  stopStack?: typeof stopStack
  restartStack?: typeof restartStack
  listStackBackups?: typeof listStackBackups
  getStackBackupPolicy?: typeof getStackBackupPolicy
  updateStackBackupPolicy?: typeof updateStackBackupPolicy
  createStackBackup?: typeof createStackBackup
  restoreStackBackup?: typeof restoreStackBackup
  deleteStackBackup?: typeof deleteStackBackup
  startStackService?: typeof startStackService
  stopStackService?: typeof stopStackService
  restartStackService?: typeof restartStackService
  inspectStackService?: typeof inspectStackService
  listStackServiceFiles?: typeof listStackServiceFiles
  getCurrentStackServiceMetrics?: typeof getCurrentStackServiceMetrics
  getStackServiceMetricsHistory?: typeof getStackServiceMetricsHistory
}

function handleStackRouteError(reply: FastifyReply, err: unknown) {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

const CreateStackBackupSchema = z.object({
  retentionCount: z.number().int().min(1).max(30).optional(),
})

const RestoreStackBackupSchema = z.object({
  restartAfterRestore: z.boolean().default(true),
})

const UpdateStackBackupPolicySchema = z.object({
  enabled: z.boolean().optional(),
  intervalHours: z.number().int().min(1).max(720).optional(),
  retentionCount: z.number().int().min(1).max(30).optional(),
  storageProvider: z.enum(['local-vps', 's3-compatible']).optional(),
  storageConfig: z.object({
    endpoint: z.string().url().optional(),
    bucket: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    prefix: z.string().optional(),
    forcePathStyle: z.boolean().optional(),
    accessKeyId: z.string().min(1).optional(),
    secretAccessKey: z.string().min(1).optional(),
  }).optional(),
})

export async function stackRoutes(app: FastifyInstance, options: { deps?: StackRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    audit: defaultAudit,
    listStacks,
    getStack,
    listStackDeployments,
    createStack,
    updateStack,
    deleteStack,
    deployStack,
    regenerateStackDeployToken,
    revokeStackDeployToken,
    listStackSecrets,
    upsertStackSecret,
    deleteStackSecret,
    listStackServices,
    startStack,
    stopStack,
    restartStack,
    listStackBackups,
    getStackBackupPolicy,
    updateStackBackupPolicy,
    createStackBackup,
    restoreStackBackup,
    deleteStackBackup,
    startStackService,
    stopStackService,
    restartStackService,
    inspectStackService,
    listStackServiceFiles,
    getCurrentStackServiceMetrics,
    getStackServiceMetricsHistory,
    ...options.deps,
  }
  const allow = (permission: Permission, fallbackRole: Parameters<typeof defaultAuthorize>[0]) =>
    deps.authorize.permission?.(permission) ?? deps.authorize(fallbackRole)

  app.get('/', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }
    try {
      return reply.send(await deps.listStacks(orgId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.getStack(orgId, stackId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/deployments', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string }
    try {
      return reply.send(await deps.listStackDeployments(orgId, stackId, Number(page) || 1, Number(limit) || 20))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }
    const input = CreateStackSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' } })
    }
    try {
      const result = await deps.createStack(orgId, input.data)
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'stack.created', resourceType: 'stack', resourceId: result.id, resourceName: result.name, ipAddress: req.ip })
      return reply.status(201).send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.patch('/:stackId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const input = UpdateStackSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' } })
    }
    try {
      const result = await deps.updateStack(orgId, stackId, input.data)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.updated',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: result.name,
        metadata: input.data,
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.delete('/:stackId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.deleteStack(orgId, stackId)
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'stack.deleted', resourceType: 'stack', resourceId: stackId, resourceName: stack.name, ipAddress: req.ip })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/deploy', { preHandler: [deps.authenticate, allow('stacks:deploy', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }

    const composeContent = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body)

    if (!composeContent?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'El contenido del docker-compose.yml es requerido' } })
    }

    try {
      const [result, stack] = await Promise.all([
        deps.deployStack(orgId, stackId, composeContent, req.userId),
        deps.getStack(orgId, stackId),
      ])
      deps.audit({ orgId, actor: { id: req.userId, email: req.userEmail, name: req.userName }, action: 'stack.deployed', resourceType: 'stack', resourceId: stackId, resourceName: stack.name, ipAddress: req.ip })
      return reply.status(202).send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/start', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.startStack(orgId, stackId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.started',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/stop', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.stopStack(orgId, stackId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.stopped',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/restart', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.restartStack(orgId, stackId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.restarted',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/backups', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.listStackBackups(orgId, stackId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/backups/policy', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.getStackBackupPolicy(orgId, stackId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.patch('/:stackId/backups/policy', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const input = UpdateStackBackupPolicySchema.safeParse(req.body ?? {})
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid backup policy' } })
    }

    try {
      const stack = await deps.getStack(orgId, stackId)
      const result = await deps.updateStackBackupPolicy(orgId, stackId, input.data)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.backup_policy_updated',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: {
          enabled: result.enabled,
          intervalHours: result.intervalHours,
          retentionCount: result.retentionCount,
          storageProvider: result.storageProvider,
        },
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/backups', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const input = CreateStackBackupSchema.safeParse(req.body ?? {})
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid backup request' } })
    }

    try {
      const stack = await deps.getStack(orgId, stackId)
      const result = await deps.createStackBackup(orgId, stackId, input.data)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.backup_created',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: { backupId: result.id, volumeCount: result.volumes.length, sizeBytes: result.sizeBytes },
        ipAddress: req.ip,
      })
      return reply.status(201).send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/backups/:backupId/restore', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, backupId } = req.params as { orgId: string; stackId: string; backupId: string }
    const input = RestoreStackBackupSchema.safeParse(req.body ?? {})
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid restore request' } })
    }

    try {
      const stack = await deps.getStack(orgId, stackId)
      const result = await deps.restoreStackBackup(orgId, stackId, backupId, input.data)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.backup_restored',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: { backupId: result.id, volumeCount: result.volumes.length, restartAfterRestore: input.data.restartAfterRestore },
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.delete('/:stackId/backups/:backupId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, backupId } = req.params as { orgId: string; stackId: string; backupId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.deleteStackBackup(orgId, stackId, backupId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.backup_deleted',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: { backupId },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.listStackServices(orgId, stackId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/services/:serviceName/start', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.startStackService(orgId, stackId, serviceName)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.service_started',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: `${stack.name}:${serviceName}`,
        metadata: { serviceName },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/services/:serviceName/stop', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.stopStackService(orgId, stackId, serviceName)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.service_stopped',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: `${stack.name}:${serviceName}`,
        metadata: { serviceName },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.post('/:stackId/services/:serviceName/restart', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.restartStackService(orgId, stackId, serviceName)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'stack.service_restarted',
        resourceType: 'stack',
        resourceId: stackId,
        resourceName: `${stack.name}:${serviceName}`,
        metadata: { serviceName },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/inspect', { preHandler: [deps.authenticate, allow('stacks:terminal', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    try {
      return reply.send(await deps.inspectStackService(orgId, stackId, serviceName))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/files', { preHandler: [deps.authenticate, allow('stacks:terminal', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    const { path = '/' } = req.query as { path?: string }
    if (!path.startsWith('/')) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } })
    }
    try {
      return reply.send(await deps.listStackServiceFiles(orgId, stackId, serviceName, path))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/metrics/current', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    try {
      const metrics = await deps.getCurrentStackServiceMetrics(orgId, stackId, serviceName)
      return reply.send(metrics ?? { message: 'No metrics yet' })
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/metrics/history', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    const { period = '1h' } = req.query as { period?: string }
    const validPeriods = ['1h', '6h', '24h'] as const
    const safePeriod = validPeriods.includes(period as typeof validPeriods[number])
      ? (period as typeof validPeriods[number])
      : '1h'

    try {
      return reply.send(await deps.getStackServiceMetricsHistory(orgId, stackId, serviceName, safePeriod))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/metrics/live', async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    const { token } = req.query as { token?: string }

    if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } })
    try {
      verifyAccessToken(token)
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    }

    try {
      const { stack, server } = await getStackForStreaming(orgId, stackId)
      const agentToken = decrypt({ encrypted: server.agentTokenEncrypted, iv: server.agentTokenIv, authTag: server.agentTokenAuthTag })

      setSseCorsHeaders(req, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

      const abortCtrl = new AbortController()
      req.raw.on('close', () => abortCtrl.abort())

      const agentRes = await fetch(
        getAgentHttpUrl(server, `/agent/v1/stacks/${stack.id}/${stack.projectName}/services/${serviceName}/metrics/stream`),
        { headers: { Authorization: `Bearer ${agentToken}` }, signal: abortCtrl.signal },
      )

      if (!agentRes.ok || !agentRes.body) {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'No se pudo conectar al agente' })}\n\n`)
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
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`)
      }
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })

  app.post('/:stackId/deploy-token', { preHandler: [deps.authenticate, allow('stacks:deploy', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      const result = await deps.regenerateStackDeployToken(orgId, stackId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'deploy_token.created',
        resourceType: 'deploy_token',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: { ownerType: 'stack', ownerId: stackId },
        ipAddress: req.ip,
      })
      return reply.send(result)
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.delete('/:stackId/deploy-token', { preHandler: [deps.authenticate, allow('stacks:deploy', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.revokeStackDeployToken(orgId, stackId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'deploy_token.deleted',
        resourceType: 'deploy_token',
        resourceId: stackId,
        resourceName: stack.name,
        metadata: { ownerType: 'stack', ownerId: stackId },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.get('/:stackId/services/:serviceName/logs', { preHandler: [deps.authenticate, allow('stacks:terminal', 'member')] }, async (req, reply) => {
    const { orgId, stackId, serviceName } = req.params as { orgId: string; stackId: string; serviceName: string }
    const { tail = '200' } = req.query as { tail?: string }

    try {
      const { stack, server } = await getStackForStreaming(orgId, stackId)
      const agentToken = decrypt({ encrypted: server.agentTokenEncrypted, iv: server.agentTokenIv, authTag: server.agentTokenAuthTag })

      const agentUrl = getAgentHttpUrl(server, `/agent/v1/stacks/${stack.id}/${stack.projectName}/services/${serviceName}/logs?tail=${tail}`)
      const agentRes = await fetch(agentUrl, {
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: AbortSignal.timeout(300_000),
      })

      if (!agentRes.ok || !agentRes.body) {
        return reply.status(502).send({ error: { code: 'AGENT_ERROR', message: 'No se pudo conectar al agente' } })
      }

      setSseCorsHeaders(req, reply)
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

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

  app.get(
    '/:stackId/services/:serviceName/terminal',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const { orgId, stackId, serviceName } = request.params as { orgId: string; stackId: string; serviceName: string }
      const { token } = request.query as { token?: string }

      if (!token) { socket.close(1008, 'Unauthorized'); return }
      let userId: string
      try {
        const payload = verifyAccessToken(token)
        userId = payload.sub
      } catch {
        socket.close(1008, 'Unauthorized')
        return
      }

      const [member] = await db
        .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
        .limit(1)

      const permissions = member ? await resolvePermissions(member.role as OrgRole, member.customRoleId) : []
      if (!permissions.includes('stacks:terminal')) {
        socket.close(1008, 'Forbidden')
        return
      }

      let serverData: { ipAddress: string; agentPort: number; agentTokenEncrypted: string; agentTokenIv: string; agentTokenAuthTag: string }
      let stackData: { id: string; projectName: string }
      try {
        const { stack, server } = await getStackForStreaming(orgId, stackId)
        serverData = server
        stackData = { id: stack.id, projectName: stack.projectName }
      } catch {
        socket.close(1011, 'Stack not available')
        return
      }

      const agentToken = decrypt({ encrypted: serverData.agentTokenEncrypted, iv: serverData.agentTokenIv, authTag: serverData.agentTokenAuthTag })
      const ts = Date.now()
      const hmacPayload = `${stackData.projectName}:${serviceName}:${ts}`
      const sig = createHmac('sha256', agentToken).update(hmacPayload).digest('hex')
      const hmacToken = `${hmacPayload}:${sig}`

      const agentWs = new WS(
        getAgentWsUrl(serverData, `/agent/v1/stacks/${stackData.id}/${stackData.projectName}/services/${serviceName}/terminal?token=${encodeURIComponent(hmacToken)}`),
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

  app.get('/:stackId/secrets', { preHandler: [deps.authenticate, allow('secrets:read', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.listStackSecrets(orgId, stackId))
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.put('/:stackId/secrets/:key', { preHandler: [deps.authenticate, allow('secrets:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, key } = req.params as { orgId: string; stackId: string; key: string }
    const input = UpsertSecretSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' } })
    }
    try {
      const stack = await deps.getStack(orgId, stackId)
      const result = await deps.upsertStackSecret(orgId, stackId, key, input.data.value)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: result.created ? 'secret.created' : 'secret.updated',
        resourceType: 'secret',
        resourceId: stackId,
        resourceName: key,
        metadata: { ownerType: 'stack', ownerId: stackId, ownerName: stack.name },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  app.delete('/:stackId/secrets/:key', { preHandler: [deps.authenticate, allow('secrets:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, key } = req.params as { orgId: string; stackId: string; key: string }
    try {
      const stack = await deps.getStack(orgId, stackId)
      await deps.deleteStackSecret(orgId, stackId, key)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'secret.deleted',
        resourceType: 'secret',
        resourceId: stackId,
        resourceName: key,
        metadata: { ownerType: 'stack', ownerId: stackId, ownerName: stack.name },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleStackRouteError(reply, err)
    }
  })

  await app.register(stackDomainRoutes, { prefix: '/:stackId/domains' })
}
