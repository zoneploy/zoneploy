import type { FastifyInstance } from 'fastify'
import { InviteMemberSchema } from '@zoneploy/types'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { createInvitation, getInvitation, acceptInvitation, declineInvitation, revokeInvitation, listInvitations } from './invitations.service.js'
import { audit } from '../../lib/audit.js'

export async function invitationRoutes(app: FastifyInstance) {

  // GET /organizations/:orgId/invitations
  app.get('/', { preHandler: [authenticate, authorize.permission('members:invite')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    return reply.send(await listInvitations(orgId))
  })

  // POST /organizations/:orgId/invitations
  app.post('/', { preHandler: [authenticate, authorize.permission('members:invite')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    const input = InviteMemberSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' },
      })
    }

    if (!request.orgMemberPermissions.includes('members:manage') && input.data.role !== 'viewer') {
      return reply.status(403).send({
        error: {
          code: 'ROLE_ASSIGNMENT_FORBIDDEN',
          message: 'Necesitás permiso para gestionar miembros antes de asignar roles en invitaciones',
        },
      })
    }
    try {
      const invitation = await createInvitation(orgId, request.userId, input.data as any)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.invited',
        resourceType: 'invitation',
        resourceId: invitation?.id,
        resourceName: input.data.email,
        metadata: { role: input.data.role, customRoleId: input.data.customRoleId ?? null },
        ipAddress: request.ip,
      })

      return reply.status(201).send(invitation)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // DELETE /organizations/:orgId/invitations/:invitationId
  app.delete('/:invitationId', { preHandler: [authenticate, authorize.permission('members:invite')] }, async (request, reply) => {
    const { orgId, invitationId } = request.params as { orgId: string; invitationId: string }

    try {
      const invitation = await revokeInvitation(orgId, invitationId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.invite_revoked',
        resourceType: 'invitation',
        resourceId: invitationId,
        resourceName: invitation.email,
        metadata: { role: invitation.role, customRoleId: invitation.customRoleId ?? null },
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

// Public invitation routes

export async function publicInvitationRoutes(app: FastifyInstance) {

  // GET /invitations/:token
  app.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    try {
      return reply.send(await getInvitation(token))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /invitations/:token/decline
  app.post('/:token/decline', { preHandler: [authenticate] }, async (request, reply) => {
    const { token } = request.params as { token: string }
    try {
      return reply.send(await declineInvitation(token, request.userId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /invitations/:token/accept
  app.post('/:token/accept', { preHandler: [authenticate] }, async (request, reply) => {
    const { token } = request.params as { token: string }
    try {
      const result = await acceptInvitation(token, request.userId)

      await audit({
        orgId: result.orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.joined',
        resourceType: 'member',
        resourceId: request.userId,
        resourceName: request.userName || request.userEmail,
        metadata: { role: result.role, email: request.userEmail },
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
}
