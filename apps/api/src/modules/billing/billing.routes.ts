import type { FastifyInstance } from 'fastify'
import { AppError } from '../../lib/errors.js'
import { handleMercadoPagoWebhook, handleStripeWebhook } from './billing.service.js'

export async function billingWebhookRoutes(app: FastifyInstance) {
  app.post('/stripe', { config: { rawBody: true } }, async (req, reply) => {
    try {
      const signature = Array.isArray(req.headers['stripe-signature'])
        ? req.headers['stripe-signature'][0]
        : req.headers['stripe-signature']

      return reply.send(await handleStripeWebhook(req.rawBody, signature))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/mercadopago', async (req, reply) => {
    try {
      const signature = Array.isArray(req.headers['x-signature'])
        ? req.headers['x-signature'][0]
        : req.headers['x-signature']
      const requestId = Array.isArray(req.headers['x-request-id'])
        ? req.headers['x-request-id'][0]
        : req.headers['x-request-id']

      return reply.send(await handleMercadoPagoWebhook({
        body: (req.body ?? {}) as Record<string, unknown>,
        query: (req.query ?? {}) as Record<string, unknown>,
        signature,
        requestId,
      }))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
