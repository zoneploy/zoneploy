import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { listMembers, changeMemberRole, removeMember, transferOwnership, getMemberAuditProfile } from './members.service.js'
import { audit } from '../../lib/audit.js'
import { assertPaidPlanFeature } from '../../lib/plan-limits.js'

const ChangeRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer', 'custom']),
  customRoleId: z.string().uuid().optional(),
})

const TransferOwnershipSchema = z.object({
  newOwnerId: z.string().uuid(),
})

export async function memberRoutes(app: FastifyInstance) {

  // GET /organizations/:orgId/members
  app.get('/', { preHandler: [authenticate, authorize.permission('members:read')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    return reply.send(await listMembers(orgId))
  })

  // PATCH /organizations/:orgId/members/:userId
  app.patch('/:userId', { preHandler: [authenticate, authorize.permission('members:manage')] }, async (request, reply) => {
    const { orgId, userId: targetUserId } = request.params as { orgId: string; userId: string }

    const input = ChangeRoleSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Rol inválido' } })
    }
    if (input.data.role === 'custom') {
      await assertPaidPlanFeature(orgId, 'custom_roles')
    }

    try {
      const targetMember = await getMemberAuditProfile(orgId, targetUserId)
      const updated = await changeMemberRole(orgId, request.userId, targetUserId, input.data.role as any, input.data.customRoleId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.role_changed',
        resourceType: 'member',
        resourceId: targetUserId,
        resourceName: targetMember.displayName,
        metadata: {
          previousRole: targetMember.role,
          newRole: input.data.role,
          customRoleId: input.data.customRoleId ?? null,
          email: targetMember.userEmail,
        },
        ipAddress: request.ip,
      })

      return reply.send(updated)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // DELETE /organizations/:orgId/members/:userId
  app.delete('/:userId', { preHandler: [authenticate, authorize.permission('members:manage')] }, async (request, reply) => {
    const { orgId, userId: targetUserId } = request.params as { orgId: string; userId: string }

    try {
      const targetMember = await getMemberAuditProfile(orgId, targetUserId)
      await removeMember(orgId, request.userId, targetUserId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.removed',
        resourceType: 'member',
        resourceId: targetUserId,
        resourceName: targetMember.displayName,
        metadata: { previousRole: targetMember.role, email: targetMember.userEmail },
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

  // POST /organizations/:orgId/members/transfer
  app.post('/transfer', { preHandler: [authenticate, authorize('owner')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    const input = TransferOwnershipSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'newOwnerId inválido' } })
    }

    try {
      const newOwner = await getMemberAuditProfile(orgId, input.data.newOwnerId)
      await transferOwnership(orgId, request.userId, input.data.newOwnerId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'member.role_changed',
        resourceType: 'member',
        resourceId: input.data.newOwnerId,
        resourceName: newOwner.displayName,
        metadata: { transfer: true, from: request.userId, previousRole: newOwner.role, newRole: 'owner', email: newOwner.userEmail },
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
