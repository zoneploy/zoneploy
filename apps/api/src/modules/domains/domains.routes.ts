import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify'
import type { Permission } from '@zoneploy/types'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { audit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import {
  addCustomEndpoint,
  addZoneployEndpoint,
  getDomain,
  listDomains,
  removeCustomEndpoint,
  removeZoneployEndpoint,
  updateCustomEndpoint,
  updateZoneployEndpoint,
  verifyCustomEndpoint,
} from './domains.service.js'

const AddZoneploySchema = z.object({
  port: z.number().int().min(1).max(65535),
})

const UpdateZoneploySchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  slug: z.string().min(3).max(63).optional(),
}).refine(data => data.port !== undefined || data.slug !== undefined, {
  message: 'At least one of port or slug is required',
})

const AddCustomSchema = z.object({
  port: z.number().int().min(1).max(65535),
  customDomain: z.string().min(4).max(253),
})

const UpdateCustomSchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  customDomain: z.string().min(4).max(253).optional(),
}).refine(data => data.port !== undefined || data.customDomain !== undefined, {
  message: 'At least one of port or customDomain is required',
})

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
  }
  throw error
}

const defaultDeps = {
  authenticate,
  authorize,
  addCustomEndpoint,
  addZoneployEndpoint,
  getDomain,
  listDomains,
  removeCustomEndpoint,
  removeZoneployEndpoint,
  updateCustomEndpoint,
  updateZoneployEndpoint,
  verifyCustomEndpoint,
  audit,
}

type DomainRouteDeps = typeof defaultDeps
type DomainRouteOptions = FastifyPluginOptions & {
  deps?: Partial<DomainRouteDeps>
}

export async function domainRoutes(app: FastifyInstance, opts: DomainRouteOptions = {}) {
  const deps: DomainRouteDeps = {
    ...defaultDeps,
    ...(opts.deps ?? {}),
  }
  const allow = (permission: Permission, fallbackRole: Parameters<typeof authorize>[0]) =>
    deps.authorize.permission?.(permission) ?? deps.authorize(fallbackRole)

  app.get('/', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.getDomain(orgId, containerId))
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.get('/all', { preHandler: [deps.authenticate, allow('containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.listDomains(orgId, containerId))
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/zoneploy', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const input = AddZoneploySchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.addZoneployEndpoint(orgId, containerId, input.data.port)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.created',
        resourceType: 'domain',
        resourceId: endpoint.id,
        resourceName: endpoint.fullDomain,
        metadata: { ownerType: 'container', ownerId: containerId, port: endpoint.port },
        ipAddress: req.ip,
      })
      return reply.status(201).send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.patch('/zoneploy/:endpointId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, endpointId } = req.params as { orgId: string; containerId: string; endpointId: string }
    const input = UpdateZoneploySchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.updateZoneployEndpoint(orgId, containerId, endpointId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.updated',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint.fullDomain,
        metadata: { ownerType: 'container', ownerId: containerId, updates: input.data },
        ipAddress: req.ip,
      })
      return reply.send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.delete('/zoneploy/:endpointId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, endpointId } = req.params as { orgId: string; containerId: string; endpointId: string }
    try {
      const endpoint = await deps.removeZoneployEndpoint(orgId, containerId, endpointId)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.deleted',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint?.fullDomain,
        metadata: { ownerType: 'container', ownerId: containerId, port: endpoint?.port },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/custom', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    const input = AddCustomSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.addCustomEndpoint(orgId, containerId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.created',
        resourceType: 'domain',
        resourceId: endpoint.id,
        resourceName: endpoint.hostname,
        metadata: { ownerType: 'container', ownerId: containerId, port: endpoint.port },
        ipAddress: req.ip,
      })
      return reply.status(201).send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.patch('/custom/:endpointId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, endpointId } = req.params as { orgId: string; containerId: string; endpointId: string }
    const input = UpdateCustomSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.updateCustomEndpoint(orgId, containerId, endpointId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.updated',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint.hostname,
        metadata: { ownerType: 'container', ownerId: containerId, updates: input.data },
        ipAddress: req.ip,
      })
      return reply.send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.delete('/custom/:endpointId', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, endpointId } = req.params as { orgId: string; containerId: string; endpointId: string }
    try {
      const endpoint = await deps.removeCustomEndpoint(orgId, containerId, endpointId)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.deleted',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint?.hostname,
        metadata: { ownerType: 'container', ownerId: containerId, port: endpoint?.port },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/custom/:endpointId/verify', { preHandler: [deps.authenticate, allow('containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, endpointId } = req.params as { orgId: string; containerId: string; endpointId: string }
    try {
      const result = await deps.verifyCustomEndpoint(orgId, containerId, endpointId)
      if (result.verified) {
        void deps.audit({
          orgId,
          actor: { id: req.userId, email: req.userEmail, name: req.userName },
          action: 'domain.custom.verified',
          resourceType: 'domain',
          resourceId: endpointId,
          resourceName: result.customDomain,
          metadata: { ownerType: 'container', ownerId: containerId, dnsRecordType: result.dnsRecordType },
          ipAddress: req.ip,
        })
      }
      return reply.send(result)
    } catch (error) {
      return handleError(error, reply)
    }
  })
}
