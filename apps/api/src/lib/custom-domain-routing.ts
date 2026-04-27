import { isIP } from 'node:net'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { config } from '../config.js'
import { addOns, containers, serverAddOnInstallations, servers, stacks } from '../db/schema.js'

export const CUSTOM_DOMAINS_EDGE_SLUG = 'custom-domains-edge'

export const LETS_ENCRYPT_PRODUCTION_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory'
export const LETS_ENCRYPT_STAGING_DIRECTORY_URL = 'https://acme-staging-v02.api.letsencrypt.org/directory'

export type CustomDomainRoutingMode = 'platform' | 'server-addon' | 'disabled'
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME'

export interface CustomDomainRoutingConfig {
  mode: CustomDomainRoutingMode
  target: string
  recordType: DnsRecordType | null
  serverId: string | null
  installationId: string | null
  resolverName: string | null
  acmeEmail: string | null
  directoryUrl: string | null
}

function inferRecordType(target: string): DnsRecordType | null {
  const ipVersion = isIP(target.trim())
  if (ipVersion === 4) return 'A'
  if (ipVersion === 6) return 'AAAA'
  if (target.trim()) return 'CNAME'
  return null
}

function normalizeConfigValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getDefaultAcmeDirectoryUrl() {
  if (config.CUSTOM_DOMAIN_ACME_DIRECTORY_URL) return config.CUSTOM_DOMAIN_ACME_DIRECTORY_URL
  return config.NODE_ENV === 'production'
    ? LETS_ENCRYPT_PRODUCTION_DIRECTORY_URL
    : LETS_ENCRYPT_STAGING_DIRECTORY_URL
}

export function buildCustomDomainsEdgeInstallConfig(
  serverIp: string,
  overrides?: Record<string, unknown>,
) {
  return {
    enabled: true,
    serverIp,
    acmeEmail:
      normalizeConfigValue(overrides?.acmeEmail)
      ?? config.CUSTOM_DOMAIN_ACME_EMAIL
      ?? 'ops@zoneploy.com',
    directoryUrl:
      normalizeConfigValue(overrides?.directoryUrl)
      ?? getDefaultAcmeDirectoryUrl(),
    resolverName:
      normalizeConfigValue(overrides?.resolverName)
      ?? 'zoneploy-edge',
    httpPort: typeof overrides?.httpPort === 'number' ? overrides.httpPort : 80,
    httpsPort: typeof overrides?.httpsPort === 'number' ? overrides.httpsPort : 443,
    internalPort:
      typeof overrides?.internalPort === 'number'
        ? overrides.internalPort
        : config.CERTS_PATH
          ? 443
          : 8899,
  }
}

export async function getCustomDomainsEdgeInstallationForServer(serverId: string) {
  const [row] = await db
    .select({
      installationId: serverAddOnInstallations.id,
      serverId: serverAddOnInstallations.serverId,
      status: serverAddOnInstallations.status,
      installationConfig: serverAddOnInstallations.config,
      serverIp: servers.ipAddress,
    })
    .from(serverAddOnInstallations)
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .innerJoin(servers, eq(serverAddOnInstallations.serverId, servers.id))
    .where(and(
      eq(serverAddOnInstallations.serverId, serverId),
      eq(serverAddOnInstallations.status, 'active'),
      isNull(serverAddOnInstallations.deletedAt),
      isNull(servers.deletedAt),
      eq(addOns.slug, CUSTOM_DOMAINS_EDGE_SLUG),
    ))
    .limit(1)

  return row ?? null
}

export async function resolveCustomDomainRoutingForServer(serverId: string | null | undefined): Promise<CustomDomainRoutingConfig> {
  if (serverId) {
    const installation = await getCustomDomainsEdgeInstallationForServer(serverId)
    if (installation?.serverIp) {
      const installConfig = (installation.installationConfig ?? {}) as Record<string, unknown>
      const target = installation.serverIp.trim()
      return {
        mode: 'server-addon',
        target,
        recordType: inferRecordType(target),
        serverId: installation.serverId,
        installationId: installation.installationId,
        resolverName: normalizeConfigValue(installConfig.resolverName),
        acmeEmail: normalizeConfigValue(installConfig.acmeEmail),
        directoryUrl: normalizeConfigValue(installConfig.directoryUrl),
      }
    }
  }

  return {
    mode: 'disabled',
    target: '',
    recordType: null,
    serverId: serverId ?? null,
    installationId: null,
    resolverName: null,
    acmeEmail: null,
    directoryUrl: null,
  }
}

export async function resolveCustomDomainRoutingForOwner(
  ownerType: 'container' | 'stack',
  ownerId: string,
) {
  if (ownerType === 'container') {
    const [owner] = await db
      .select({ serverId: containers.serverId })
      .from(containers)
      .where(and(eq(containers.id, ownerId), isNull(containers.deletedAt)))
      .limit(1)

    return resolveCustomDomainRoutingForServer(owner?.serverId ?? null)
  }

  const [owner] = await db
    .select({ serverId: stacks.serverId })
    .from(stacks)
    .where(and(eq(stacks.id, ownerId), isNull(stacks.deletedAt)))
    .limit(1)

  return resolveCustomDomainRoutingForServer(owner?.serverId ?? null)
}

export function isPlatformManagedCustomDomainRouting(routing: CustomDomainRoutingConfig) {
  return routing.mode === 'platform'
}
