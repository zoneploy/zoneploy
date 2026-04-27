import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify'
import type { Permission } from '@zoneploy/types'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { audit } from '../../lib/audit.js'
import { AppError } from '../../lib/errors.js'
import {
  addStackCustomEndpoint,
  addStackZoneployEndpoint,
  listStackDomains,
  removeStackCustomEndpoint,
  removeStackZoneployEndpoint,
  updateStackCustomEndpoint,
  updateStackZoneployEndpoint,
  verifyStackCustomEndpoint,
} from './stacks.service.js'

const AddStackZoneploySchema = z.object({
  port: z.number().int().min(1).max(65535),
})

const UpdateStackZoneploySchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  slug: z.string().min(3).max(63).optional(),
}).refine(data => data.port !== undefined || data.slug !== undefined, {
  message: 'At least one of port or slug is required',
})

const AddStackCustomSchema = z.object({
  port: z.number().int().min(1).max(65535),
  customDomain: z.string().min(4).max(253),
})

const UpdateStackCustomSchema = z.object({
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
  addStackCustomEndpoint,
  addStackZoneployEndpoint,
  listStackDomains,
  removeStackCustomEndpoint,
  removeStackZoneployEndpoint,
  updateStackCustomEndpoint,
  updateStackZoneployEndpoint,
  verifyStackCustomEndpoint,
  audit,
}

type StackDomainRouteDeps = typeof defaultDeps
type StackDomainRouteOptions = FastifyPluginOptions & {
  deps?: Partial<StackDomainRouteDeps>
}

export async function stackDomainRoutes(app: FastifyInstance, opts: StackDomainRouteOptions = {}) {
  const deps: StackDomainRouteDeps = {
    ...defaultDeps,
    ...(opts.deps ?? {}),
  }
  const allow = (permission: Permission, fallbackRole: Parameters<typeof authorize>[0]) =>
    deps.authorize.permission?.(permission) ?? deps.authorize(fallbackRole)

  app.get('/', { preHandler: [deps.authenticate, allow('stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.listStackDomains(orgId, stackId))
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/zoneploy', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const input = AddStackZoneploySchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.addStackZoneployEndpoint(orgId, stackId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.created',
        resourceType: 'domain',
        resourceId: endpoint.id,
        resourceName: endpoint.fullDomain,
        metadata: { ownerType: 'stack', ownerId: stackId, port: endpoint.port },
        ipAddress: req.ip,
      })
      return reply.status(201).send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.patch('/zoneploy/:endpointId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, endpointId } = req.params as { orgId: string; stackId: string; endpointId: string }
    const input = UpdateStackZoneploySchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.updateStackZoneployEndpoint(orgId, stackId, endpointId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.updated',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint.fullDomain,
        metadata: { ownerType: 'stack', ownerId: stackId, updates: input.data },
        ipAddress: req.ip,
      })
      return reply.send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.delete('/zoneploy/:endpointId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, endpointId } = req.params as { orgId: string; stackId: string; endpointId: string }
    try {
      const endpoint = await deps.removeStackZoneployEndpoint(orgId, stackId, endpointId)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.zoneploy.deleted',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint?.fullDomain,
        metadata: { ownerType: 'stack', ownerId: stackId, port: endpoint?.port },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/custom', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    const input = AddStackCustomSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.addStackCustomEndpoint(orgId, stackId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.created',
        resourceType: 'domain',
        resourceId: endpoint.id,
        resourceName: endpoint.hostname,
        metadata: { ownerType: 'stack', ownerId: stackId, port: endpoint.port },
        ipAddress: req.ip,
      })
      return reply.status(201).send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.patch('/custom/:endpointId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, endpointId } = req.params as { orgId: string; stackId: string; endpointId: string }
    const input = UpdateStackCustomSchema.safeParse(req.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid input' } })
    }

    try {
      const endpoint = await deps.updateStackCustomEndpoint(orgId, stackId, endpointId, input.data)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.updated',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint.hostname,
        metadata: { ownerType: 'stack', ownerId: stackId, updates: input.data },
        ipAddress: req.ip,
      })
      return reply.send(endpoint)
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.delete('/custom/:endpointId', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, endpointId } = req.params as { orgId: string; stackId: string; endpointId: string }
    try {
      const endpoint = await deps.removeStackCustomEndpoint(orgId, stackId, endpointId)
      void deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'domain.custom.deleted',
        resourceType: 'domain',
        resourceId: endpointId,
        resourceName: endpoint?.hostname,
        metadata: { ownerType: 'stack', ownerId: stackId, port: endpoint?.port },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (error) {
      return handleError(error, reply)
    }
  })

  app.post('/custom/:endpointId/verify', { preHandler: [deps.authenticate, allow('stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, endpointId } = req.params as { orgId: string; stackId: string; endpointId: string }
    try {
      const result = await deps.verifyStackCustomEndpoint(orgId, stackId, endpointId)
      if (result.verified) {
        void deps.audit({
          orgId,
          actor: { id: req.userId, email: req.userEmail, name: req.userName },
          action: 'domain.custom.verified',
          resourceType: 'domain',
          resourceId: endpointId,
          resourceName: result.customDomain,
          metadata: { ownerType: 'stack', ownerId: stackId, dnsRecordType: result.dnsRecordType },
          ipAddress: req.ip,
        })
      }
      return reply.send(result)
    } catch (error) {
      return handleError(error, reply)
    }
  })
}
