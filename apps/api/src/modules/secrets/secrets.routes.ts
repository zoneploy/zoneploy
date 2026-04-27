import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { listSecrets, upsertSecret, deleteSecret } from './secrets.service.js'

const UpsertSchema = z.object({
  value: z.string().min(1, 'Value cannot be empty').max(5000),
})

export async function secretRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [authenticate, authorize.permission('secrets:read')] },
    async (req, reply) => {
      const { orgId, containerId } = req.params as { orgId: string; containerId: string }
      try {
        return reply.send(await listSecrets(orgId, containerId))
      } catch (err) {
        if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        throw err
      }
    },
  )

  app.put(
    '/:key',
    { preHandler: [authenticate, authorize.permission('secrets:write')] },
    async (req, reply) => {
      const { orgId, containerId, key } = req.params as {
        orgId: string
        containerId: string
        key: string
      }

      const input = UpsertSchema.safeParse(req.body)
      if (!input.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid value' },
        })
      }

      try {
        const result = await upsertSecret(orgId, containerId, key.toUpperCase(), input.data.value)
        return reply.send(result)
      } catch (err) {
        if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        throw err
      }
    },
  )

  app.delete(
    '/:key',
    { preHandler: [authenticate, authorize.permission('secrets:write')] },
    async (req, reply) => {
      const { orgId, containerId, key } = req.params as {
        orgId: string
        containerId: string
        key: string
      }
      try {
        await deleteSecret(orgId, containerId, key)
        return reply.status(204).send()
      } catch (err) {
        if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        throw err
      }
    },
  )
}
