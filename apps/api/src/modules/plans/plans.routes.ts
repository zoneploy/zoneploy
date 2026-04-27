import type { FastifyInstance, FastifyReply } from 'fastify'
import { AppError } from '../../lib/errors.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { createBillingCheckout } from '../billing/billing.service.js'
import type { BillingProvider } from '../billing/billing-providers.js'
import { changePlan, getBillingOptions, getSubscription, listPlans } from './plans.service.js'

const SUBSCRIPTION_CHANGES_ENABLED = false
const SUBSCRIPTION_CHANGES_PRELAUNCH_MESSAGE = 'Subscription changes are disabled during pre-launch.'

function sendSubscriptionChangesDisabled(reply: FastifyReply) {
  return reply.status(423).send({
    error: {
      code: 'SUBSCRIPTION_CHANGES_PRELAUNCH_DISABLED',
      message: SUBSCRIPTION_CHANGES_PRELAUNCH_MESSAGE,
    },
  })
}

export async function planRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    try {
      return reply.send(await listPlans())
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get('/billing-options', { preHandler: [authenticate] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }

    try {
      return reply.send(await getBillingOptions(orgId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }

    try {
      return reply.send(await getSubscription(orgId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/upgrade', { preHandler: [authenticate, authorize.permission('billing:manage')] }, async (req, reply) => {
    if (!SUBSCRIPTION_CHANGES_ENABLED) return sendSubscriptionChangesDisabled(reply)

    const { orgId } = req.params as { orgId: string }
    const { planId } = req.body as { planId?: string }

    if (!planId) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'planId es requerido' } })
    }

    try {
      return reply.send(await changePlan(orgId, req.userId, planId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/checkout', { preHandler: [authenticate, authorize.permission('billing:manage')] }, async (req, reply) => {
    if (!SUBSCRIPTION_CHANGES_ENABLED) return sendSubscriptionChangesDisabled(reply)

    const { orgId } = req.params as { orgId: string }
    const { planId, provider } = req.body as { planId?: string; provider?: BillingProvider }

    if (!planId) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'planId es requerido' } })
    }

    try {
      return reply.send(await createBillingCheckout({
        orgId,
        userId: req.userId,
        userEmail: req.userEmail,
        userName: req.userName,
        planId,
        provider,
      }))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
