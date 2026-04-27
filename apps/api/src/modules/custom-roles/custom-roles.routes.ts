import type { FastifyInstance } from 'fastify'
import { CreateCustomRoleSchema, UpdateCustomRoleSchema } from '@zoneploy/types'
import {
  listCustomRoles, getCustomRole, createCustomRole, updateCustomRole, deleteCustomRole,
} from './custom-roles.service.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'

export async function customRoleRoutes(app: FastifyInstance) {
  const canViewRoles = authorize.any(['members:read', 'members:invite', 'members:manage'])

  app.get('/', { preHandler: [authenticate, canViewRoles] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    return reply.send(await listCustomRoles(orgId))
  })

  app.get('/:roleId', { preHandler: [authenticate, canViewRoles] }, async (request, reply) => {
    const { orgId, roleId } = request.params as { orgId: string; roleId: string }

    try {
      return reply.send(await getCustomRole(orgId, roleId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.post('/', { preHandler: [authenticate, authorize.permission('members:manage')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    const input = CreateCustomRoleSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
      })
    }

    try {
      const result = await createCustomRole(orgId, input.data)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'role.created',
        resourceType: 'custom_role',
        resourceId: result.id,
        resourceName: result.name,
        metadata: { permissions: result.permissions },
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

  app.patch('/:roleId', { preHandler: [authenticate, authorize.permission('members:manage')] }, async (request, reply) => {
    const { orgId, roleId } = request.params as { orgId: string; roleId: string }

    const input = UpdateCustomRoleSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
      })
    }

    try {
      const result = await updateCustomRole(orgId, roleId, input.data)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'role.updated',
        resourceType: 'custom_role',
        resourceId: roleId,
        resourceName: result.name,
        metadata: { permissions: result.permissions },
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

  app.delete('/:roleId', { preHandler: [authenticate, authorize.permission('members:manage')] }, async (request, reply) => {
    const { orgId, roleId } = request.params as { orgId: string; roleId: string }

    try {
      const role = await getCustomRole(orgId, roleId)
      await deleteCustomRole(orgId, roleId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'role.deleted',
        resourceType: 'custom_role',
        resourceId: roleId,
        resourceName: role.name,
        metadata: { permissions: role.permissions },
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
