import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../plugins/authenticate.js'
import { AppError } from '../../lib/errors.js'
import {
  listNotifications,
  countUnread,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from './notifications.service.js'

export async function notificationRoutes(app: FastifyInstance) {

  // GET /notifications
  // Lists all user notifications. Supports pagination with ?limit and ?offset.
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string }
    try {
      const items = await listNotifications(request.userId, Math.min(Number(limit), 100), Number(offset))
      const unread = await countUnread(request.userId)
      return reply.send({ items, unread })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /notifications/:id/read
  app.post('/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return reply.send(await markAsRead(request.userId, id))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // POST /notifications/read-all
  app.post('/read-all', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      return reply.send(await markAllAsRead(request.userId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // DELETE /notifications/:id
  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteNotification(request.userId, id)
      return reply.status(204).send()
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
