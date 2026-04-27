import { eq, and, inArray, ne, isNull } from 'drizzle-orm'
import { collectPreflightReport } from '@zoneploy/runtime'
import { db } from '../../db/client.js'
import {
  addOnBindings,
  containers,
  customPublicEndpoints,
  environments,
  organizations,
  orgMembers,
  plans,
  projects,
  serverAddOnInstallations,
  servers,
  stacks,
  subscriptions,
  zoneployPublicEndpoints,
} from '../../db/schema.js'
import { NotFoundError, ForbiddenError, ConflictError, AppError } from '../../lib/errors.js'
import { generateSlug } from '../../lib/slug.js'
import { createNotification } from '../notifications/notifications.service.js'
import { resolvePermissions } from '../../plugins/authorize.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { getZoneployFullDomain } from '../../lib/public-endpoints.js'
import { encrypt } from '../../lib/crypto.js'
import type { OrgRole } from '@zoneploy/types'

const ENTITLED_SUBSCRIPTION_STATUSES: Array<'active' | 'trialing' | 'past_due'> = ['active', 'trialing', 'past_due']

// Formatting helpers

function formatOrg(o: typeof organizations.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    ownerId: o.ownerId,
    billingCountry: o.billingCountry,
    logoUrl: o.logoUrl,
    require2fa: o.require2fa,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }
}

// Services

export async function createOrg(userId: string, name: string) {
  const [existingOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.status, 'active'), isNull(organizations.deletedAt)))
    .limit(1)

  if (existingOrg) {
    throw new ConflictError('This self-hosted instance already has a workspace')
  }

  const slug = generateSlug(name)

  const [org] = await db
    .insert(organizations)
    .values({ name, slug, ownerId: userId })
    .returning()

  if (!org) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear la organización')

  // Owner membership.
  await db.insert(orgMembers).values({
    orgId: org.id,
    userId,
    role: 'owner',
  })

  // Free subscription.
  const [freePlan] = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, 'free'))
    .limit(1)

  if (!freePlan) throw new AppError(500, 'SEED_REQUIRED', 'Plan Free no encontrado. Ejecutá: pnpm db:seed')

  const now = new Date()

  await db.insert(subscriptions).values({
    orgId: org.id,
    planId: freePlan.id,
    currentPeriodStart: now,
    currentPeriodEnd: new Date('2099-12-31'),
  })

  const localToken = encrypt(`local-${org.id}`)
  const preflight = await collectPreflightReport()

  await db.insert(servers).values({
    orgId: org.id,
    name: 'Local VPS',
    ipAddress: '127.0.0.1',
    sshUser: 'root',
    sshPort: 22,
    agentPort: 0,
    agentMode: 'self_hosted',
    agentTokenEncrypted: localToken.encrypted,
    agentTokenIv: localToken.iv,
    agentTokenAuthTag: localToken.authTag,
    status: 'online',
    lastHeartbeatAt: now,
    runtimeInfo: preflight.runtimeInfo,
    capabilities: preflight.capabilities,
    conflicts: preflight.conflicts,
    lastPreflightAt: new Date(preflight.checkedAt),
    totalCpuCores: preflight.runtimeInfo.totalCpuCores,
    totalMemoryMb: preflight.runtimeInfo.totalMemoryMb,
    totalStorageMb: preflight.runtimeInfo.totalStorageMb,
  })

  createNotification({
    userId,
    orgId: org.id,
    type: 'org_created',
    data: { orgName: org.name },
    link: '/settings',
  }).catch(err => console.error('Error creando notificación org_created:', err))

  const permissions = await resolvePermissions('owner', null)

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logoUrl,
    role: 'owner' as const,
    customRoleId: null,
    permissions,
  }
}

export async function getOrg(orgId: string, userId: string) {
  const [member] = await db
    .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1)

  if (!member) throw new ForbiddenError('No sos miembro de esta organización')

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.status, 'active'), isNull(organizations.deletedAt)))
    .limit(1)

  if (!org) throw new NotFoundError('Organización no encontrada')

  const [sub] = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      planName: plans.name,
      planSlug: plans.slug,
      planMaxServers: plans.maxServers,
      planMaxDeployments: plans.maxDeployments,
      planMaxSubdomains: plans.maxSubdomains,
      planMaxCustomDomains: plans.maxCustomDomains,
      planMaxInstalledAddOns: plans.maxInstalledAddOns,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)))
    .limit(1)

  const permissions = await resolvePermissions(member.role as OrgRole, member.customRoleId)

  return {
    ...formatOrg(org),
    role: member.role,
    customRoleId: member.customRoleId,
    permissions,
    subscription: sub
      ? {
          ...sub,
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        }
      : null,
  }
}

export async function updateOrg(
  orgId: string,
  data: { name?: string; require2fa?: boolean; billingCountry?: 'AR' | 'US' | null },
) {
  const [org] = await db
    .update(organizations)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.require2fa !== undefined ? { require2fa: data.require2fa } : {}),
      ...(data.billingCountry !== undefined ? { billingCountry: data.billingCountry } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(organizations.id, orgId), eq(organizations.status, 'active'), isNull(organizations.deletedAt)))
    .returning()

  if (!org) throw new NotFoundError('Organización no encontrada')

  return formatOrg(org)
}

export async function updateOrgLogo(orgId: string, logoUrl: string, logoKey: string) {
  const [org] = await db
    .update(organizations)
    .set({ logoUrl, logoKey, updatedAt: new Date() })
    .where(and(eq(organizations.id, orgId), eq(organizations.status, 'active'), isNull(organizations.deletedAt)))
    .returning()

  if (!org) throw new NotFoundError('Organización no encontrada')

  return { logoUrl: org.logoUrl }
}

export async function deleteOrgLogo(orgId: string) {
  await db
    .update(organizations)
    .set({ logoUrl: null, logoKey: null, updatedAt: new Date() })
    .where(and(eq(organizations.id, orgId), eq(organizations.status, 'active'), isNull(organizations.deletedAt)))
}

export async function listUserOrgs(userId: string) {
  const memberships = await db
    .select({
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
      joinedAt: orgMembers.joinedAt,
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgLogoUrl: organizations.logoUrl,
      orgRequire2fa: organizations.require2fa,
      orgStatus: organizations.status,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.userId, userId),
        eq(organizations.status, 'active'),
        isNull(organizations.deletedAt),
      ),
    )

  return Promise.all(memberships.map(async m => ({
    id: m.orgId,
    name: m.orgName,
    slug: m.orgSlug,
    logoUrl: m.orgLogoUrl,
    require2fa: m.orgRequire2fa,
    role: m.role,
    customRoleId: m.customRoleId,
    permissions: await resolvePermissions(m.role as OrgRole, m.customRoleId),
    joinedAt: m.joinedAt.toISOString(),
  })))
}

export async function deleteOrg(orgId: string, userId: string) {
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  if (!org) throw new NotFoundError('Organización no encontrada')
  if (org.ownerId !== userId) throw new ForbiddenError('Solo el owner puede eliminar la organización')

  const [zoneployEndpoints, customEndpoints] = await Promise.all([
    db
      .select({ ownerType: zoneployPublicEndpoints.ownerType, hostnameLabel: zoneployPublicEndpoints.hostnameLabel })
      .from(zoneployPublicEndpoints)
      .where(and(eq(zoneployPublicEndpoints.orgId, orgId), isNull(zoneployPublicEndpoints.deletedAt))),
    db
      .select({ hostname: customPublicEndpoints.hostname })
      .from(customPublicEndpoints)
      .where(and(eq(customPublicEndpoints.orgId, orgId), isNull(customPublicEndpoints.deletedAt))),
  ])

  const now = new Date()
  await db.transaction(async tx => {
    await Promise.all([
      tx
        .update(addOnBindings)
        .set({ status: 'disabled', deletedAt: now, deletedByUserId: userId, deleteReason: 'organization_deleted', updatedAt: now })
        .where(and(eq(addOnBindings.orgId, orgId), isNull(addOnBindings.deletedAt))),
      tx
        .update(serverAddOnInstallations)
        .set({ status: 'disabled', deletedAt: now, deletedByUserId: userId, deleteReason: 'organization_deleted', updatedAt: now })
        .where(and(eq(serverAddOnInstallations.orgId, orgId), isNull(serverAddOnInstallations.deletedAt))),
      tx
        .update(zoneployPublicEndpoints)
        .set({ isPrimary: false, deletedAt: now, deletedByUserId: userId, deleteReason: 'organization_deleted', updatedAt: now })
        .where(and(eq(zoneployPublicEndpoints.orgId, orgId), isNull(zoneployPublicEndpoints.deletedAt))),
      tx
        .update(customPublicEndpoints)
        .set({ isPrimary: false, verified: false, deletedAt: now, deletedByUserId: userId, deleteReason: 'organization_deleted', updatedAt: now })
        .where(and(eq(customPublicEndpoints.orgId, orgId), isNull(customPublicEndpoints.deletedAt))),
      tx
        .update(containers)
        .set({ status: 'stopped', deletedAt: now, updatedAt: now })
        .where(and(eq(containers.orgId, orgId), isNull(containers.deletedAt))),
      tx
        .update(stacks)
        .set({ status: 'stopped', deletedAt: now, updatedAt: now })
        .where(and(eq(stacks.orgId, orgId), isNull(stacks.deletedAt))),
      tx
        .update(servers)
        .set({ status: 'offline', deletedAt: now, updatedAt: now })
        .where(and(eq(servers.orgId, orgId), isNull(servers.deletedAt))),
      tx
        .update(environments)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(environments.orgId, orgId), isNull(environments.deletedAt))),
      tx
        .update(projects)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt))),
      tx
        .update(subscriptions)
        .set({ status: 'canceled', canceledAt: now, updatedAt: now })
        .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES))),
      tx
        .update(organizations)
        .set({ status: 'deleted', deletedAt: now, updatedAt: now })
        .where(eq(organizations.id, orgId)),
    ])
  })

  const routeHosts = [
    ...zoneployEndpoints.map(endpoint => getZoneployFullDomain(endpoint.ownerType, endpoint.hostnameLabel)),
    ...customEndpoints.map(endpoint => endpoint.hostname),
  ]

  if (routeHosts.length > 0) {
    await redis.hdel(REDIS_KEYS.routesHash, ...routeHosts).catch(() => null)
  }
}
