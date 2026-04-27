import type { FastifyInstance } from 'fastify'
import { AuditQuerySchema } from '@zoneploy/types'
import { db } from '../../db/client.js'
import { auditLogs } from '../../db/schema.js'
import { and, eq, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'

export async function auditRoutes(app: FastifyInstance) {

  // GET /organizations/:orgId/audit
  app.get('/', { preHandler: [authenticate, authorize.permission('audit:read')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    const query = AuditQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Parámetros de query inválidos' },
      })
    }

    const { page, limit, action, actorId, resourceType, from, to } = query.data

    const conditions = [eq(auditLogs.orgId, orgId)]

    if (action)       conditions.push(eq(auditLogs.action, action))
    if (actorId)      conditions.push(eq(auditLogs.actorId, actorId))
    if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType))
    if (from)         conditions.push(gte(auditLogs.createdAt, new Date(from)))
    if (to)           conditions.push(lte(auditLogs.createdAt, new Date(to)))

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return reply.send({
      data: rows.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: { page, limit },
    })
  })
}
