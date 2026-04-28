import { and, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { containers, customPublicEndpoints, servers, zoneployPublicEndpoints } from '../../db/schema.js'
import { config } from '../../config.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import {
  AppError,
  NotFoundError,
} from '../../lib/errors.js'
import {
  CUSTOM_DOMAINS_EDGE_SLUG,
  resolveCustomDomainRoutingForOwner,
} from '../../lib/custom-domain-routing.js'
import { getContainerAgentClient } from '../../lib/server-agent-client.js'
import {
  assertValidZoneploySlug,
  buildZoneployHostnameLabel,
  generateZoneploySlug,
  getPreferredPublicHost,
  getZoneployFullDomain,
  listCustomEndpoints,
  listZoneployEndpoints,
  promoteNextPrimaryPublicEndpoint,
} from '../../lib/public-endpoints.js'
import { removeCustomDomainTls } from '../../lib/custom-domain-tls.js'
import { findVerifiedCustomDomainConflict } from '../../lib/custom-domain-claims.js'
import { buildDnsTargetInstructions, verifyHostnamePointsToTarget } from '../../lib/verify-dns-target.js'
import { listContainerDomainsWithDeps } from './container-domain-listing.js'
import { buildContainerPortMappingsFromEndpoints, syncContainerRuntimeRoutesWithDeps } from './container-runtime-routes.js'
import {
  addContainerCustomEndpointWithDeps,
  addContainerZoneployEndpointWithDeps,
  removeContainerCustomEndpointWithDeps,
  removeContainerZoneployEndpointWithDeps,
  updateContainerZoneployEndpointWithDeps,
  updateContainerCustomEndpointWithDeps,
  verifyContainerCustomEndpointWithDeps,
} from './container-domain-operations.js'

function getContainerZoneploySlug(hostnameLabel: string) {
  if (config.SUBDOMAIN_SUFFIX && hostnameLabel.endsWith(config.SUBDOMAIN_SUFFIX)) {
    return hostnameLabel.slice(0, -config.SUBDOMAIN_SUFFIX.length)
  }
  return hostnameLabel
}

function validateCustomDomain(hostname: string) {
  const re = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
  if (!re.test(hostname)) throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', 'Invalid domain format')
  if (hostname.endsWith(`.${config.ROUTING_DOMAIN}`)) {
    throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', `Cannot use a ${config.ROUTING_DOMAIN} subdomain as a custom domain`)
  }
}

function formatZoneployEndpoint(endpoint: typeof zoneployPublicEndpoints.$inferSelect) {
  return {
    id: endpoint.id,
    containerId: endpoint.ownerId,
    port: endpoint.port,
    slug: getContainerZoneploySlug(endpoint.hostnameLabel),
    hostnameLabel: endpoint.hostnameLabel,
    fullDomain: getZoneployFullDomain('container', endpoint.hostnameLabel),
    isPrimary: endpoint.isPrimary,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
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
    enabled: routing.mode === 'server-addon' && !!routing.target && !!routing.recordType,
    addonSlug: CUSTOM_DOMAINS_EDGE_SLUG,
    serverId: routing.serverId,
    installationId: routing.installationId,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
  }
}

function assertCustomDomainsEnabled(
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  if (routing.mode !== 'server-addon' || !routing.target || !routing.recordType) {
    throw new AppError(403, 'CUSTOM_DOMAINS_ADDON_REQUIRED', 'Install Custom Domains Edge on this server to use custom domains')
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
  const [zoneployRows, customRows] = await Promise.all([
    listZoneployEndpoints('container', containerId),
    listCustomEndpoints('container', containerId),
  ])
  return buildContainerPortMappingsFromEndpoints(zoneployRows, customRows)
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
  const [zoneployRows, customRows] = await Promise.all([
    listZoneployEndpoints('container', containerId),
    listCustomEndpoints('container', containerId),
  ])

  for (const endpoint of zoneployRows) {
    await redis.hset(REDIS_KEYS.routesHash, getZoneployFullDomain('container', endpoint.hostnameLabel), routeTarget)
  }

  if (routing.mode === 'platform') {
    for (const endpoint of customRows) {
      if (!endpoint.verified) continue
      await redis.hset(REDIS_KEYS.routesHash, endpoint.hostname, routeTarget)
    }
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
  const [zoneployRows, customRows] = await Promise.all([
    listZoneployEndpoints('container', containerId),
    listCustomEndpoints('container', containerId),
  ])

  return {
    zoneployRows,
    customRows,
    total: zoneployRows.length + customRows.length,
  }
}

async function assertUniqueContainerZoneployPort(containerId: string, port: number, currentId?: string) {
  const [existing] = await db
    .select({ id: zoneployPublicEndpoints.id })
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.ownerType, 'container'),
      eq(zoneployPublicEndpoints.ownerId, containerId),
      eq(zoneployPublicEndpoints.port, port),
      isNull(zoneployPublicEndpoints.deletedAt),
      ...(currentId ? [ne(zoneployPublicEndpoints.id, currentId)] : []),
    ))
    .limit(1)

  if (existing) {
    throw new AppError(409, 'ZONEPLOY_PORT_ALREADY_EXISTS', `Port ${port} already has a Zoneploy domain in this container`)
  }
}

async function assertUniqueContainerZoneployHostname(hostnameLabel: string, currentId?: string) {
  const [existing] = await db
    .select({ id: zoneployPublicEndpoints.id })
      .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.hostnameLabel, hostnameLabel),
      isNull(zoneployPublicEndpoints.deletedAt),
      ...(currentId ? [ne(zoneployPublicEndpoints.id, currentId)] : []),
    ))
    .limit(1)

  if (existing) {
    throw new AppError(409, 'ZONEPLOY_HOSTNAME_IN_USE', `Subdomain ${hostnameLabel} is already in use`)
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
  const [zoneployRows, customRows] = await Promise.all([
    listZoneployEndpoints('container', containerId),
    listCustomEndpoints('container', containerId),
  ])

  const preferredHost = getPreferredPublicHost('container', zoneployRows, customRows)
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
    listZoneployRows: (id) => listZoneployEndpoints('container', id),
    listCustomRows: (id) => listCustomEndpoints('container', id),
    formatZoneployEndpoint,
    formatCustomEndpoint,
    formatCustomRouting,
  })
}

export async function addZoneployEndpoint(orgId: string, containerId: string, port: number) {
  await getContainerRow(orgId, containerId)
  const counts = await getContainerEndpointCounts(containerId)
  return addContainerZoneployEndpointWithDeps(containerId, generateZoneploySlug(), counts.total, port, {
    buildHostnameLabel: (slug) => buildZoneployHostnameLabel('container', slug),
    assertUniquePort: assertUniqueContainerZoneployPort,
    assertUniqueHostnameLabel: assertUniqueContainerZoneployHostname,
    persistCreate: async (values) => {
      const [created] = await db
        .insert(zoneployPublicEndpoints)
        .values({
          orgId,
          ownerType: 'container',
          ownerId: containerId,
          port: values.port,
          hostnameLabel: values.hostnameLabel,
          isPrimary: values.isPrimary,
        })
        .returning()
      return created
    },
    syncRuntime: syncContainerRuntimeRoutes,
    formatZoneployEndpoint,
  })
}

export async function updateZoneployEndpoint(
  orgId: string,
  containerId: string,
  endpointId: string,
  updates: { port?: number; slug?: string },
) {
  await getContainerRow(orgId, containerId)

  const [endpoint] = await db
    .select()
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.id, endpointId),
      eq(zoneployPublicEndpoints.ownerType, 'container'),
      eq(zoneployPublicEndpoints.ownerId, containerId),
      isNull(zoneployPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Zoneploy endpoint not found')

  return updateContainerZoneployEndpointWithDeps(
    containerId,
    endpoint,
    getContainerZoneploySlug(endpoint.hostnameLabel),
    updates,
    {
      validateZoneploySlug: assertValidZoneploySlug,
      buildHostnameLabel: (slug) => buildZoneployHostnameLabel('container', slug),
      removeHostsFromRedis,
      assertUniquePort: assertUniqueContainerZoneployPort,
      assertUniqueHostnameLabel: assertUniqueContainerZoneployHostname,
      persistUpdate: async (id, next) => {
        const [updated] = await db
          .update(zoneployPublicEndpoints)
          .set({
            port: next.port,
            hostnameLabel: next.hostnameLabel,
            updatedAt: new Date(),
          })
          .where(eq(zoneployPublicEndpoints.id, id))
          .returning()
        return updated
      },
      syncRuntime: syncContainerRuntimeRoutes,
      formatZoneployEndpoint,
    },
  )
}

export async function removeZoneployEndpoint(orgId: string, containerId: string, endpointId: string) {
  await getContainerRow(orgId, containerId)

  const [endpoint] = await db
    .select()
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.id, endpointId),
      eq(zoneployPublicEndpoints.ownerType, 'container'),
      eq(zoneployPublicEndpoints.ownerId, containerId),
      isNull(zoneployPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Zoneploy endpoint not found')

  await removeContainerZoneployEndpointWithDeps(containerId, endpoint, {
    removeHostsFromRedis,
    deleteEndpoint: async (id) => {
      await db
        .update(zoneployPublicEndpoints)
        .set({
          isPrimary: false,
          deletedAt: new Date(),
          deleteReason: 'domain_removed',
          updatedAt: new Date(),
        })
        .where(eq(zoneployPublicEndpoints.id, id))
    },
    promoteNextPrimary: promoteNextPrimaryPublicEndpoint,
    syncRuntime: syncContainerRuntimeRoutes,
  })

  return formatZoneployEndpoint(endpoint)
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
