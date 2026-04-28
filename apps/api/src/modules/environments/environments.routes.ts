import type { FastifyInstance } from 'fastify'
import { CreateEnvironmentSchema, UpdateEnvironmentSchema, UpsertSecretSchema } from '@zoneploy/types'
import {
  listEnvironments, getEnvironment, createEnvironment, updateEnvironment, deleteEnvironment,
  listEnvSecretKeys, upsertEnvSecret, deleteEnvSecret,
} from './environments.service.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'

export async function environmentRoutes(app: FastifyInstance) {

  // GET /organizations/:orgId/projects/:projectId/environments
  app.get('/', { preHandler: [authenticate, authorize.permission('environments:read')] }, async (request, reply) => {
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }
    return reply.send(await listEnvironments(orgId, projectId))
  })

  // GET .../environments/:envId
  app.get('/:envId', { preHandler: [authenticate, authorize.permission('environments:read')] }, async (request, reply) => {
    const { orgId, projectId, envId } = request.params as { orgId: string; projectId: string; envId: string }

    try {
      return reply.send(await getEnvironment(orgId, projectId, envId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST .../environments
  app.post('/', { preHandler: [authenticate, authorize.permission('environments:create')] }, async (request, reply) => {
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }

    const input = CreateEnvironmentSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
      })
    }

    try {
      const result = await createEnvironment(orgId, projectId, input.data)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'environment.created',
        resourceType: 'environment',
        resourceId: result.id,
        resourceName: result.name,
        metadata: { projectId, isProtected: result.isProtected },
        ipAddress: request.ip,
      })

      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // PATCH .../environments/:envId
  app.patch('/:envId', { preHandler: [authenticate, authorize.permission('environments:update')] }, async (request, reply) => {
    const { orgId, projectId, envId } = request.params as { orgId: string; projectId: string; envId: string }

    const input = UpdateEnvironmentSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
      })
    }

    try {
      const result = await updateEnvironment(orgId, projectId, envId, input.data)

      if (input.data.name !== undefined) {
        await audit({
          orgId,
          actor: { id: request.userId, email: request.userEmail, name: request.userName },
          action: 'environment.updated',
          resourceType: 'environment',
          resourceId: envId,
          resourceName: result.name,
          metadata: { projectId, name: input.data.name },
          ipAddress: request.ip,
        })
      }

      if (input.data.isProtected !== undefined) {
        await audit({
          orgId,
          actor: { id: request.userId, email: request.userEmail, name: request.userName },
          action: 'environment.protected_toggled',
          resourceType: 'environment',
          resourceId: envId,
          resourceName: result.name,
          metadata: { isProtected: input.data.isProtected },
          ipAddress: request.ip,
        })
      }

      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // DELETE .../environments/:envId
  app.delete('/:envId', { preHandler: [authenticate, authorize.permission('environments:delete')] }, async (request, reply) => {
    const { orgId, projectId, envId } = request.params as { orgId: string; projectId: string; envId: string }

    try {
      const env = await getEnvironment(orgId, projectId, envId)
      await deleteEnvironment(orgId, projectId, envId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'environment.deleted',
        resourceType: 'environment',
        resourceId: envId,
        resourceName: env.name,
        metadata: { projectId },
        ipAddress: request.ip,
      })

      return reply.status(204).send()
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // Env Secrets

  // GET .../environments/:envId/secrets
  app.get('/:envId/secrets', { preHandler: [authenticate, authorize.permission('secrets:read')] }, async (request, reply) => {
    const { orgId, envId } = request.params as { orgId: string; envId: string }
    return reply.send(await listEnvSecretKeys(orgId, envId))
  })

  // PUT .../environments/:envId/secrets/:key
  app.put('/:envId/secrets/:key', { preHandler: [authenticate, authorize.permission('secrets:write')] }, async (request, reply) => {
    const { orgId, envId, key } = request.params as { orgId: string; envId: string; key: string }

    const input = UpsertSecretSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid value' },
      })
    }

    try {
      const result = await upsertEnvSecret(orgId, envId, key, input.data.value)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: result.created ? 'env_secret.created' : 'env_secret.updated',
        resourceType: 'env_secret',
        resourceId: envId,
        resourceName: key,
        ipAddress: request.ip,
      })

      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // DELETE .../environments/:envId/secrets/:key
  app.delete('/:envId/secrets/:key', { preHandler: [authenticate, authorize.permission('secrets:write')] }, async (request, reply) => {
    const { orgId, envId, key } = request.params as { orgId: string; envId: string; key: string }

    try {
      await deleteEnvSecret(orgId, envId, key)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'env_secret.deleted',
        resourceType: 'env_secret',
        resourceId: envId,
        resourceName: key,
        ipAddress: request.ip,
      })

      return reply.status(204).send()
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
