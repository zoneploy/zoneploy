import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { organizations, plans, subscriptions } from '../../db/schema.js'
import { NotFoundError } from '../../lib/errors.js'
import { assertPlanAllowsUsage, getPlanUsage } from '../../lib/plan-limits.js'
import { getBillingProviderOptions } from '../billing/billing-providers.js'

const ENTITLED_SUBSCRIPTION_STATUSES: Array<'active' | 'trialing' | 'past_due'> = ['active', 'trialing', 'past_due']

export async function listPlans() {
  return db
    .select({
      id: plans.id,
      name: plans.name,
      slug: plans.slug,
      features: plans.features,
      maxServers: plans.maxServers,
      maxDeployments: plans.maxDeployments,
      maxSubdomains: plans.maxSubdomains,
      maxCustomDomains: plans.maxCustomDomains,
      maxInstalledAddOns: plans.maxInstalledAddOns,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      sortOrder: plans.sortOrder,
    })
    .from(plans)
    .where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder))
}

export async function getSubscription(orgId: string) {
  const [sub] = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      billingProvider: subscriptions.billingProvider,
      externalCustomerId: subscriptions.externalCustomerId,
      externalSubscriptionId: subscriptions.externalSubscriptionId,
      externalPriceId: subscriptions.externalPriceId,
      externalStatus: subscriptions.externalStatus,
      paymentFailureAt: subscriptions.paymentFailureAt,
      gracePeriodStartedAt: subscriptions.gracePeriodStartedAt,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      planId: plans.id,
      planName: plans.name,
      planSlug: plans.slug,
      maxServers: plans.maxServers,
      maxDeployments: plans.maxDeployments,
      maxSubdomains: plans.maxSubdomains,
      maxCustomDomains: plans.maxCustomDomains,
      maxInstalledAddOns: plans.maxInstalledAddOns,
      priceMonthlyUsd: plans.priceMonthlyUsd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)))
    .limit(1)

  if (!sub) throw new NotFoundError('Suscripción no encontrada')

  const usage = await getPlanUsage(orgId)
  const billingOptions = await getBillingOptions(orgId)

  return {
    ...sub,
    billingOptions,
    usage,
  }
}

export async function getBillingOptions(orgId: string) {
  const [org] = await db
    .select({ billingCountry: organizations.billingCountry })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  if (!org) throw new NotFoundError('Organización no encontrada')

  return getBillingProviderOptions(org.billingCountry)
}

export async function changePlan(orgId: string, _userId: string, newPlanId: string) {
  const [newPlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, newPlanId), eq(plans.isActive, true)))
    .limit(1)

  if (!newPlan) throw new NotFoundError('Plan no encontrado')

  await assertPlanAllowsUsage(orgId, newPlan.id)

  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)))
    .limit(1)

  if (!sub) throw new NotFoundError('Suscripción activa no encontrada')

  await db.update(subscriptions).set({ planId: newPlan.id, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id))

  return getSubscription(orgId)
}
