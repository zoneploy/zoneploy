import { and, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { containers, customPublicEndpoints, servers } from '../../db/schema.js'
import { config } from '../../config.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import {
  AppError,
  NotFoundError,
} from '../../lib/errors.js'
import { resolveCustomDomainRoutingForOwner } from '../../lib/custom-domain-routing.js'
import { getContainerAgentClient } from '../../lib/server-agent-client.js'
import {
  getPreferredPublicHost,
  listCustomEndpoints,
  promoteNextPrimaryPublicEndpoint,
} from '../../lib/public-endpoints.js'
import { removeCustomDomainTls } from '../../lib/custom-domain-tls.js'
import { findVerifiedCustomDomainConflict } from '../../lib/custom-domain-claims.js'
import { verifyHostnamePointsToTarget } from '../../lib/verify-dns-target.js'
import { listContainerDomainsWithDeps } from './container-domain-listing.js'
import { buildContainerPortMappingsFromEndpoints, syncContainerRuntimeRoutesWithDeps } from './container-runtime-routes.js'
import {
  addContainerCustomEndpointWithDeps,
  removeContainerCustomEndpointWithDeps,
  updateContainerCustomEndpointWithDeps,
  verifyContainerCustomEndpointWithDeps,
} from './container-domain-operations.js'

function validateCustomDomain(hostname: string) {
  const re = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
  if (!re.test(hostname)) throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', 'Invalid domain format')
  if (hostname.endsWith(`.${config.ROUTING_DOMAIN}`)) {
    throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', `Cannot use a ${config.ROUTING_DOMAIN} subdomain as a custom domain`)
  }
}

function formatCustomEndpoint(
  endpoint: typeof customPublicEndpoints.$inferSelect,
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  return {
    id: endpoint.id,
    containerId: endpoint.ownerId,
    port: endpoint.port,
    hostname: endpoint.hostname,
    verified: endpoint.verified,
    isPrimary: endpoint.isPrimary,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
    routingMode: routing.mode,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  }
}

function formatCustomRouting(
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  return {
    mode: routing.mode,
    enabled: routing.mode === 'server' && !!routing.target && !!routing.recordType,
    serverId: routing.serverId,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
  }
}

function assertCustomDomainsEnabled(
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  if (routing.mode !== 'server' || !routing.target || !routing.recordType) {
    throw new AppError(403, 'CUSTOM_DOMAIN_ROUTING_DISABLED', 'Custom domain routing is not available for this server')
  }
}

async function getContainerRow(orgId: string, containerId: string) {
  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')
  return container
}

async function markContainerNeedsRedeploy(containerId: string) {
  await db
    .update(containers)
    .set({ needsRedeploy: true, updatedAt: new Date() })
    .where(eq(containers.id, containerId))
}

async function clearContainerNeedsRedeploy(containerId: string) {
  await db
    .update(containers)
    .set({ needsRedeploy: false, updatedAt: new Date() })
    .where(eq(containers.id, containerId))
}

async function removeHostsFromRedis(hosts: string[]) {
  for (const host of hosts) {
    await redis.hdel(REDIS_KEYS.routesHash, host)
  }
}

async function buildContainerPortMappings(containerId: string) {
  const customRows = await listCustomEndpoints('container', containerId)
  return buildContainerPortMappingsFromEndpoints(customRows)
}

async function syncRedisForContainerDomains(containerId: string) {
  const [container] = await db
    .select({
      id: containers.id,
      serverId: containers.serverId,
      deletedAt: containers.deletedAt,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1)

  if (!container?.serverId || container.deletedAt) return

  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, container.serverId))
    .limit(1)

  if (!server) return

  const routePort = server.agentMode === 'self_hosted' ? 80 : config.CERTS_PATH ? 443 : 8899
  const routeTarget = JSON.stringify({ ip: server.ipAddress, port: routePort })
  const routing = await resolveCustomDomainRoutingForOwner('container', containerId)
  const customRows = await listCustomEndpoints('container', containerId)

  if (routing.mode !== 'server') return

  for (const endpoint of customRows) {
    if (!endpoint.verified) continue
    await redis.hset(REDIS_KEYS.routesHash, endpoint.hostname, routeTarget)
  }
}

async function syncContainerRuntimeRoutes(containerId: string) {
  return syncContainerRuntimeRoutesWithDeps(containerId, {
    getContainer: async (id) => {
      const [container] = await db
        .select()
        .from(containers)
        .where(eq(containers.id, id))
        .limit(1)
      return container
    },
    getServer: async (serverId) => {
      const [server] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1)
      return server
    },
    buildPortMappings: buildContainerPortMappings,
    syncRoutes: (server, payload) => getContainerAgentClient(server as typeof servers.$inferSelect).syncContainerRoutes(server as typeof servers.$inferSelect, payload),
    syncRedis: syncRedisForContainerDomains,
    markNeedsRedeploy: markContainerNeedsRedeploy,
    clearNeedsRedeploy: clearContainerNeedsRedeploy,
    platformDomain: config.ROUTING_DOMAIN,
  })
}

async function getContainerEndpointCounts(containerId: string) {
  const customRows = await listCustomEndpoints('container', containerId)

  return {
    customRows,
    total: customRows.length,
  }
}

async function assertUniqueContainerCustomHostname(containerId: string, hostname: string, currentId?: string) {
  const [existing] = await db
    .select({ id: customPublicEndpoints.id })
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.ownerType, 'container'),
      eq(customPublicEndpoints.ownerId, containerId),
      eq(customPublicEndpoints.hostname, hostname),
      isNull(customPublicEndpoints.deletedAt),
      ...(currentId ? [ne(customPublicEndpoints.id, currentId)] : []),
    ))
    .limit(1)

  if (existing) {
    throw new AppError(409, 'CUSTOM_DOMAIN_ALREADY_EXISTS', `Domain ${hostname} already exists in this container`)
  }
}

export async function getDomain(orgId: string, containerId: string) {
  await getContainerRow(orgId, containerId)
  await syncContainerRuntimeRoutes(containerId).catch(() => false)
  const customRows = await listCustomEndpoints('container', containerId)

  const preferredHost = getPreferredPublicHost(customRows)
  return preferredHost
    ? {
        hostname: preferredHost.hostname,
        kind: preferredHost.kind,
        verified: preferredHost.verified,
      }
    : null
}

export async function listDomains(orgId: string, containerId: string) {
  await getContainerRow(orgId, containerId)
  return listContainerDomainsWithDeps(containerId, {
    syncRuntime: syncContainerRuntimeRoutes,
    resolveRouting: (id) => resolveCustomDomainRoutingForOwner('container', id),
    listCustomRows: (id) => listCustomEndpoints('container', id),
    formatCustomEndpoint,
    formatCustomRouting,
  })
}

export async function addCustomEndpoint(
  orgId: string,
  containerId: string,
  input: { port: number; customDomain: string },
) {
  const routing = await resolveCustomDomainRoutingForOwner('container', containerId)
  await getContainerRow(orgId, containerId)
  const counts = await getContainerEndpointCounts(containerId)
  return addContainerCustomEndpointWithDeps(containerId, counts.total, input, routing, {
    assertCustomDomainsEnabled,
    validateCustomDomain,
    assertUniqueHostname: assertUniqueContainerCustomHostname,
    persistCreate: async (values) => {
      const [created] = await db
        .insert(customPublicEndpoints)
        .values({
          orgId,
          ownerType: 'container',
          ownerId: containerId,
          port: values.port,
          hostname: values.hostname,
          isPrimary: values.isPrimary,
        })
        .returning()
      return created
    },
    syncRuntime: syncContainerRuntimeRoutes,
    formatCustomEndpoint,
  })
}

export async function updateCustomEndpoint(
  orgId: string,
  containerId: string,
  endpointId: string,
  updates: { port?: number; customDomain?: string },
) {
  await getContainerRow(orgId, containerId)
  const routing = await resolveCustomDomainRoutingForOwner('container', containerId)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'container'),
      eq(customPublicEndpoints.ownerId, containerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  return updateContainerCustomEndpointWithDeps(containerId, endpoint, updates, routing, {
    assertCustomDomainsEnabled,
    validateCustomDomain,
    assertUniqueHostname: assertUniqueContainerCustomHostname,
    removeHostsFromRedis,
    removeCustomDomainTls,
    persistUpdate: async (id, next) => {
      const [updated] = await db
        .update(customPublicEndpoints)
        .set({
          port: next.port,
          hostname: next.hostname,
          verified: next.verified,
          updatedAt: new Date(),
        })
        .where(eq(customPublicEndpoints.id, id))
        .returning()
      return updated
    },
    syncRuntime: syncContainerRuntimeRoutes,
    formatCustomEndpoint,
  })
}

export async function removeCustomEndpoint(orgId: string, containerId: string, endpointId: string) {
  await getContainerRow(orgId, containerId)
  const routing = await resolveCustomDomainRoutingForOwner('container', containerId)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'container'),
      eq(customPublicEndpoints.ownerId, containerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  await removeContainerCustomEndpointWithDeps(containerId, endpoint, {
    removeHostsFromRedis,
    removeCustomDomainTls,
    deleteEndpoint: async (id) => {
      await db
        .update(customPublicEndpoints)
        .set({
          isPrimary: false,
          verified: false,
          deletedAt: new Date(),
          deleteReason: 'domain_removed',
          updatedAt: new Date(),
        })
        .where(eq(customPublicEndpoints.id, id))
    },
    promoteNextPrimary: promoteNextPrimaryPublicEndpoint,
    syncRuntime: syncContainerRuntimeRoutes,
  })

  return formatCustomEndpoint(endpoint, routing)
}

export async function verifyCustomEndpoint(orgId: string, containerId: string, endpointId: string) {
  await getContainerRow(orgId, containerId)
  const routing = await resolveCustomDomainRoutingForOwner('container', containerId)
  assertCustomDomainsEnabled(routing)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'container'),
      eq(customPublicEndpoints.ownerId, containerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  return verifyContainerCustomEndpointWithDeps(containerId, endpoint, routing, {
    assertCustomDomainsEnabled,
    verifyHostnamePointsToTarget,
    findVerifiedCustomDomainConflict,
    removeCustomDomainTls,
    markVerified: async (id) => {
      await db
        .update(customPublicEndpoints)
        .set({ verified: true, updatedAt: new Date() })
        .where(eq(customPublicEndpoints.id, id))
    },
    syncRuntime: syncContainerRuntimeRoutes,
  })
}
