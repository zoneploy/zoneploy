import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  addOns,
  containers,
  customPublicEndpoints,
  serverAddOnInstallations,
  servers,
  stacks,
  zoneployPublicEndpoints,
} from '../db/schema.js'

export type PaidPlanFeature = 'audit_log' | 'custom_roles'

export type PlanUsage = {
  servers: number
  deployments: number
  subdomains: number
  customDomains: number
  installedAddOns: number
}

export function assertPaidPlanSlug(planSlug: string | null | undefined, feature: PaidPlanFeature) {
  void planSlug
  void feature
}

export async function assertPaidPlanFeature(orgId: string, feature: PaidPlanFeature) {
  void orgId
  void feature
}

export async function getPlanUsage(orgId: string): Promise<PlanUsage> {
  const [
    [serverCount],
    [containerCount],
    [stackCount],
    [subdomainCount],
    [customDomainCount],
    [installedAddOnCount],
  ] = await Promise.all([
    db.select({ value: count() }).from(servers).where(and(eq(servers.orgId, orgId), isNull(servers.deletedAt))),
    db.select({ value: count() }).from(containers).where(and(eq(containers.orgId, orgId), isNull(containers.deletedAt))),
    db.select({ value: count() }).from(stacks).where(and(eq(stacks.orgId, orgId), isNull(stacks.deletedAt))),
    db.select({ value: count() }).from(zoneployPublicEndpoints).where(and(eq(zoneployPublicEndpoints.orgId, orgId), isNull(zoneployPublicEndpoints.deletedAt))),
    db.select({ value: count() }).from(customPublicEndpoints).where(and(eq(customPublicEndpoints.orgId, orgId), isNull(customPublicEndpoints.deletedAt))),
    db
      .select({ value: count() })
      .from(serverAddOnInstallations)
      .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
      .where(and(
        eq(serverAddOnInstallations.orgId, orgId),
        eq(serverAddOnInstallations.status, 'active'),
        eq(addOns.isActive, true),
        isNull(serverAddOnInstallations.deletedAt),
      )),
  ])

  return {
    servers: serverCount?.value ?? 0,
    deployments: (containerCount?.value ?? 0) + (stackCount?.value ?? 0),
    subdomains: subdomainCount?.value ?? 0,
    customDomains: customDomainCount?.value ?? 0,
    installedAddOns: installedAddOnCount?.value ?? 0,
  }
}

export async function assertServerLimit(orgId: string) {
  void orgId
}

export async function assertDeploymentLimit(orgId: string) {
  void orgId
}

export async function assertSubdomainLimit(orgId: string) {
  void orgId
}

export async function assertCustomDomainLimit(orgId: string) {
  void orgId
}

export async function assertInstalledAddOnLimit(orgId: string) {
  void orgId
}

export async function assertPlanAllowsUsage(orgId: string, planId: string) {
  void orgId
  void planId
}
