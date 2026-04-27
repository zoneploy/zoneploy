import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import Stripe from 'stripe'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { billingEvents, organizations, plans, subscriptions } from '../../db/schema.js'
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { assertPlanAllowsUsage } from '../../lib/plan-limits.js'
import type { BillingProvider } from './billing-providers.js'
import { getAvailableBillingProviders, selectDefaultBillingProvider } from './billing-providers.js'

const BILLABLE_PLAN_SLUGS = ['starter', 'pro', 'enterprise'] as const
type BillablePlanSlug = (typeof BILLABLE_PLAN_SLUGS)[number]
type EntitledSubscriptionStatus = 'active' | 'trialing' | 'past_due'
type NormalizedSubscriptionStatus = EntitledSubscriptionStatus | 'canceled'

const ENTITLED_SUBSCRIPTION_STATUSES: EntitledSubscriptionStatus[] = ['active', 'trialing', 'past_due']

let stripeClient: Stripe | null = null

interface CheckoutInput {
  orgId: string
  userId: string
  userEmail: string
  userName: string
  planId: string
  provider?: BillingProvider
}

interface BillingEventInsert {
  provider: BillingProvider
  eventId: string
  eventType: string
  payload: Record<string, unknown>
}

interface ApplySubscriptionInput {
  orgId: string
  planId: string
  provider: BillingProvider
  status: NormalizedSubscriptionStatus
  externalCustomerId?: string | null
  externalSubscriptionId?: string | null
  externalPriceId?: string | null
  externalStatus?: string | null
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  paymentFailureAt?: Date | null
}

export interface BillingCheckoutResponse {
  action: 'redirect' | 'updated'
  provider: BillingProvider | null
  checkoutUrl: string | null
}

function getSuccessUrl(provider: BillingProvider, planSlug: string) {
  const url = new URL(config.BILLING_SUCCESS_URL ?? `${config.APP_URL}/billing`)
  url.searchParams.set('billing', 'success')
  url.searchParams.set('provider', provider)
  url.searchParams.set('plan', planSlug)
  return url.toString()
}

function getCancelUrl(provider: BillingProvider, planSlug: string) {
  const url = new URL(config.BILLING_CANCEL_URL ?? `${config.APP_URL}/billing`)
  url.searchParams.set('billing', 'cancel')
  url.searchParams.set('provider', provider)
  url.searchParams.set('plan', planSlug)
  return url.toString()
}

function getWebhookUrl(provider: BillingProvider) {
  return `${config.PLATFORM_URL.replace(/\/$/, '')}/api/v1/billing/webhooks/${provider}`
}

function getStripeClient() {
  if (!config.STRIPE_SECRET_KEY) {
    throw new AppError(503, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured')
  }
  stripeClient ??= new Stripe(config.STRIPE_SECRET_KEY)
  return stripeClient
}

function requireMercadoPagoAccessToken() {
  if (!config.MERCADOPAGO_ACCESS_TOKEN) {
    throw new AppError(503, 'MERCADOPAGO_NOT_CONFIGURED', 'Mercado Pago is not configured')
  }
  return config.MERCADOPAGO_ACCESS_TOKEN
}

function asBillablePlanSlug(slug: string): BillablePlanSlug {
  if (BILLABLE_PLAN_SLUGS.includes(slug as BillablePlanSlug)) return slug as BillablePlanSlug
  throw new ValidationError('This plan does not require checkout', 'PLAN_DOES_NOT_REQUIRE_CHECKOUT')
}

function getStripePriceId(planSlug: string) {
  switch (asBillablePlanSlug(planSlug)) {
    case 'starter':
      return config.STRIPE_PRICE_STARTER_MONTHLY
    case 'pro':
      return config.STRIPE_PRICE_PRO_MONTHLY
    case 'enterprise':
      return config.STRIPE_PRICE_ENTERPRISE_MONTHLY
  }
}

function getMercadoPagoPlanId(planSlug: string) {
  switch (asBillablePlanSlug(planSlug)) {
    case 'starter':
      return config.MERCADOPAGO_PLAN_STARTER_MONTHLY
    case 'pro':
      return config.MERCADOPAGO_PLAN_PRO_MONTHLY
    case 'enterprise':
      return config.MERCADOPAGO_PLAN_ENTERPRISE_MONTHLY
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): NormalizedSubscriptionStatus {
  if (status === 'active' || status === 'trialing') return status
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
  return 'past_due'
}

function mapMercadoPagoStatus(status: string | null | undefined): NormalizedSubscriptionStatus {
  if (status === 'authorized') return 'active'
  if (status === 'cancelled' || status === 'canceled') return 'canceled'
  return 'past_due'
}

function stripeDate(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000) : null
}

function getStripeSubscriptionPriceId(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0]
  return item?.price.id ?? null
}

function getStripeSubscriptionPeriodStart(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0]
  return stripeDate(item?.current_period_start)
}

function getStripeSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0]
  return stripeDate(item?.current_period_end)
}

function getStripeInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const value = (invoice as unknown as { subscription?: string | { id?: string } }).subscription
  return typeof value === 'string' ? value : value?.id
}

function parseMercadoPagoExternalReference(reference: string | null | undefined) {
  const [orgId, planId] = (reference ?? '').split(':')
  if (!orgId || !planId) return null
  return { orgId, planId }
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

async function findCheckoutContext(orgId: string, planId: string) {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, billingCountry: organizations.billingCountry })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  if (!org) throw new NotFoundError('Organización no encontrada')

  const [plan] = await db
    .select({
      id: plans.id,
      name: plans.name,
      slug: plans.slug,
      priceMonthlyUsd: plans.priceMonthlyUsd,
    })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.isActive, true)))
    .limit(1)

  if (!plan) throw new NotFoundError('Plan no encontrado')

  const [subscription] = await db
    .select({ id: subscriptions.id, planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)))
    .limit(1)

  if (!subscription) throw new NotFoundError('Suscripción activa no encontrada')

  return { org, plan, subscription }
}

async function applyFreePlan(orgId: string) {
  const [freePlan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, 'free')).limit(1)
  if (!freePlan) throw new AppError(500, 'SEED_REQUIRED', 'Free plan not found')

  await db
    .update(subscriptions)
    .set({
      planId: freePlan.id,
      status: 'active',
      billingProvider: null,
      externalPriceId: null,
      externalStatus: 'canceled',
      paymentFailureAt: null,
      gracePeriodStartedAt: null,
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.orgId, orgId))
}

async function applySubscriptionUpdate(input: ApplySubscriptionInput) {
  if (input.status === 'canceled') {
    await applyFreePlan(input.orgId)
    return
  }

  const patch = {
    planId: input.planId,
    status: input.status,
    billingProvider: input.provider,
    externalCustomerId: input.externalCustomerId ?? null,
    externalSubscriptionId: input.externalSubscriptionId ?? null,
    externalPriceId: input.externalPriceId ?? null,
    externalStatus: input.externalStatus ?? input.status,
    currentPeriodStart: input.currentPeriodStart ?? new Date(),
    currentPeriodEnd: input.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    paymentFailureAt: input.paymentFailureAt ?? (input.status === 'past_due' ? new Date() : null),
    gracePeriodStartedAt: input.status === 'past_due' ? new Date() : null,
    canceledAt: null,
    updatedAt: new Date(),
  }

  await db.update(subscriptions).set(patch).where(eq(subscriptions.orgId, input.orgId))
}

async function recordBillingEvent(input: BillingEventInsert) {
  const [event] = await db
    .insert(billingEvents)
    .values({
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [billingEvents.provider, billingEvents.eventId],
    })
    .returning({ id: billingEvents.id })

  return event?.id ?? null
}

async function markBillingEvent(id: string, status: 'processed' | 'ignored' | 'failed', errorMessage?: string) {
  await db
    .update(billingEvents)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      processedAt: new Date(),
    })
    .where(eq(billingEvents.id, id))
}

export async function createBillingCheckout(input: CheckoutInput): Promise<BillingCheckoutResponse> {
  const { org, plan } = await findCheckoutContext(input.orgId, input.planId)
  await assertPlanAllowsUsage(input.orgId, plan.id)

  if (Number(plan.priceMonthlyUsd) === 0) {
    const { changePlan } = await import('../plans/plans.service.js')
    await changePlan(input.orgId, input.userId, plan.id)
    return { action: 'updated', provider: null, checkoutUrl: null }
  }

  const availableProviders = getAvailableBillingProviders(org.billingCountry)
  const provider = input.provider ?? selectDefaultBillingProvider(org.billingCountry)
  if (!availableProviders.includes(provider)) {
    throw new ValidationError('Payment provider is not available for this billing country', 'BILLING_PROVIDER_NOT_AVAILABLE')
  }

  if (provider === 'stripe') {
    return createStripeCheckout({
      orgId: input.orgId,
      orgName: org.name,
      userEmail: input.userEmail,
      userName: input.userName,
      planId: plan.id,
      planName: plan.name,
      planSlug: plan.slug,
    })
  }

  return createMercadoPagoCheckout({
    orgId: input.orgId,
    userEmail: input.userEmail,
    planId: plan.id,
    planName: plan.name,
    planSlug: plan.slug,
  })
}

async function createStripeCheckout(input: {
  orgId: string
  orgName: string
  userEmail: string
  userName: string
  planId: string
  planName: string
  planSlug: string
}): Promise<BillingCheckoutResponse> {
  const priceId = getStripePriceId(input.planSlug)
  if (!priceId) throw new AppError(503, 'STRIPE_PRICE_NOT_CONFIGURED', `Stripe price is not configured for ${input.planSlug}`)

  const stripe = getStripeClient()
  const metadata = {
    orgId: input.orgId,
    planId: input.planId,
    planSlug: input.planSlug,
    provider: 'stripe',
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: input.userEmail,
    client_reference_id: input.orgId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    subscription_data: { metadata },
    success_url: `${getSuccessUrl('stripe', input.planSlug)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: getCancelUrl('stripe', input.planSlug),
    allow_promotion_codes: true,
    customer_creation: 'always',
    billing_address_collection: 'auto',
    custom_text: {
      submit: {
        message: `Subscribe ${input.orgName} to Zoneploy ${input.planName}.`,
      },
    },
  })

  if (!session.url) throw new AppError(502, 'STRIPE_CHECKOUT_FAILED', 'Stripe did not return a checkout URL')
  return { action: 'redirect', provider: 'stripe', checkoutUrl: session.url }
}

async function createMercadoPagoCheckout(input: {
  orgId: string
  userEmail: string
  planId: string
  planName: string
  planSlug: string
}): Promise<BillingCheckoutResponse> {
  const accessToken = requireMercadoPagoAccessToken()
  const preapprovalPlanId = getMercadoPagoPlanId(input.planSlug)
  if (!preapprovalPlanId) {
    throw new AppError(503, 'MERCADOPAGO_PLAN_NOT_CONFIGURED', `Mercado Pago plan is not configured for ${input.planSlug}`)
  }

  const response = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      preapproval_plan_id: preapprovalPlanId,
      reason: `Zoneploy ${input.planName}`,
      external_reference: `${input.orgId}:${input.planId}:${input.planSlug}`,
      payer_email: input.userEmail,
      back_url: getSuccessUrl('mercadopago', input.planSlug),
      notification_url: getWebhookUrl('mercadopago'),
    }),
  })

  const payload = await response.json() as { init_point?: string; sandbox_init_point?: string; message?: string }
  if (!response.ok) {
    throw new AppError(502, 'MERCADOPAGO_CHECKOUT_FAILED', payload.message ?? 'Mercado Pago checkout failed')
  }

  const checkoutUrl = payload.init_point ?? payload.sandbox_init_point
  if (!checkoutUrl) throw new AppError(502, 'MERCADOPAGO_CHECKOUT_FAILED', 'Mercado Pago did not return a checkout URL')

  return { action: 'redirect', provider: 'mercadopago', checkoutUrl }
}

export async function handleStripeWebhook(rawBody: string | Buffer | undefined, signature: string | undefined) {
  if (!rawBody) throw new ValidationError('Missing raw webhook body', 'WEBHOOK_RAW_BODY_REQUIRED')
  if (!signature) throw new ValidationError('Missing Stripe signature', 'STRIPE_SIGNATURE_REQUIRED')
  if (!config.STRIPE_WEBHOOK_SECRET) throw new AppError(503, 'STRIPE_WEBHOOK_NOT_CONFIGURED', 'Stripe webhook secret is not configured')

  const stripe = getStripeClient()
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET)
  const eventId = await recordBillingEvent({
    provider: 'stripe',
    eventId: event.id,
    eventType: event.type,
    payload: event as unknown as Record<string, unknown>,
  })

  if (!eventId) return { received: true, duplicate: true }

  try {
    const processed = await processStripeEvent(event)
    await markBillingEvent(eventId, processed ? 'processed' : 'ignored')
    return { received: true, duplicate: false }
  } catch (err) {
    await markBillingEvent(eventId, 'failed', err instanceof Error ? err.message : 'Unknown webhook error')
    throw err
  }
}

async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await processStripeCheckoutSession(event.data.object as Stripe.Checkout.Session)
      return true
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await processStripeSubscription(event.data.object as Stripe.Subscription)
      return true
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await processStripeInvoice(event.data.object as Stripe.Invoice, event.type)
      return true
    default:
      return false
  }
}

async function processStripeCheckoutSession(session: Stripe.Checkout.Session) {
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (!subscriptionId) return

  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId)
  await processStripeSubscription(subscription)
}

async function processStripeSubscription(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata?.orgId
  const planId = subscription.metadata?.planId
  if (!orgId || !planId) return

  const status = mapStripeStatus(subscription.status)
  await applySubscriptionUpdate({
    orgId,
    planId,
    provider: 'stripe',
    status,
    externalCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    externalSubscriptionId: subscription.id,
    externalPriceId: getStripeSubscriptionPriceId(subscription),
    externalStatus: subscription.status,
    currentPeriodStart: getStripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: getStripeSubscriptionPeriodEnd(subscription),
    paymentFailureAt: status === 'past_due' ? new Date() : null,
  })
}

async function processStripeInvoice(invoice: Stripe.Invoice, eventType: 'invoice.paid' | 'invoice.payment_failed') {
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId)
  const status = eventType === 'invoice.payment_failed' ? 'past_due' : mapStripeStatus(subscription.status)
  const orgId = subscription.metadata?.orgId
  const planId = subscription.metadata?.planId
  if (!orgId || !planId) return

  await applySubscriptionUpdate({
    orgId,
    planId,
    provider: 'stripe',
    status,
    externalCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    externalSubscriptionId: subscription.id,
    externalPriceId: getStripeSubscriptionPriceId(subscription),
    externalStatus: eventType === 'invoice.payment_failed' ? 'invoice.payment_failed' : subscription.status,
    currentPeriodStart: getStripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: getStripeSubscriptionPeriodEnd(subscription),
    paymentFailureAt: eventType === 'invoice.payment_failed' ? new Date() : null,
  })
}

export async function handleMercadoPagoWebhook(input: {
  body: Record<string, unknown>
  query: Record<string, unknown>
  signature?: string
  requestId?: string
}) {
  if (config.MERCADOPAGO_WEBHOOK_SECRET) {
    verifyMercadoPagoSignature({
      signature: input.signature,
      requestId: input.requestId,
      dataId: getMercadoPagoDataId(input.body, input.query),
      secret: config.MERCADOPAGO_WEBHOOK_SECRET,
    })
  }

  const dataId = getMercadoPagoDataId(input.body, input.query)
  const eventType = String(input.body.type ?? input.body.action ?? input.query.type ?? 'mercadopago.notification')
  const eventId = String(input.body.id ?? input.query.id ?? input.requestId ?? dataId)

  const billingEventId = await recordBillingEvent({
    provider: 'mercadopago',
    eventId,
    eventType,
    payload: input.body,
  })

  if (!billingEventId) return { received: true, duplicate: true }

  try {
    const processed = await processMercadoPagoEvent(dataId)
    await markBillingEvent(billingEventId, processed ? 'processed' : 'ignored')
    return { received: true, duplicate: false }
  } catch (err) {
    await markBillingEvent(billingEventId, 'failed', err instanceof Error ? err.message : 'Unknown webhook error')
    throw err
  }
}

function getMercadoPagoDataId(body: Record<string, unknown>, query: Record<string, unknown>) {
  const data = body.data as { id?: unknown } | undefined
  return String(query['data.id'] ?? query.id ?? data?.id ?? body.id ?? '')
}

function verifyMercadoPagoSignature(input: {
  signature?: string
  requestId?: string
  dataId: string
  secret: string
}) {
  if (!input.signature || !input.requestId) {
    throw new ValidationError('Missing Mercado Pago signature headers', 'MERCADOPAGO_SIGNATURE_REQUIRED')
  }

  const parts = Object.fromEntries(input.signature.split(',').map(part => {
    const [key, value] = part.split('=')
    return [key?.trim(), value?.trim()]
  }))
  const timestamp = parts.ts
  const hash = parts.v1
  if (!timestamp || !hash) throw new ValidationError('Invalid Mercado Pago signature', 'MERCADOPAGO_SIGNATURE_INVALID')

  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${timestamp};`
  const expected = crypto.createHmac('sha256', input.secret).update(manifest).digest('hex')
  if (!timingSafeEqualHex(expected, hash)) {
    throw new ValidationError('Invalid Mercado Pago signature', 'MERCADOPAGO_SIGNATURE_INVALID')
  }
}

async function processMercadoPagoEvent(dataId: string) {
  if (!dataId) return false

  const accessToken = requireMercadoPagoAccessToken()
  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) return false

  const preapproval = await response.json() as {
    id?: string
    status?: string
    external_reference?: string
    preapproval_plan_id?: string
  }
  const reference = parseMercadoPagoExternalReference(preapproval.external_reference)
  if (!reference) return false

  await applySubscriptionUpdate({
    orgId: reference.orgId,
    planId: reference.planId,
    provider: 'mercadopago',
    status: mapMercadoPagoStatus(preapproval.status),
    externalSubscriptionId: preapproval.id ?? dataId,
    externalPriceId: preapproval.preapproval_plan_id ?? null,
    externalStatus: preapproval.status ?? null,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    paymentFailureAt: preapproval.status === 'authorized' ? null : new Date(),
  })

  return true
}
