import { isIP } from 'node:net'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { config } from '../config.js'
import { containers, servers, stacks } from '../db/schema.js'

export type CustomDomainRoutingMode = 'server' | 'disabled'
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME'

export interface CustomDomainRoutingConfig {
  mode: CustomDomainRoutingMode
  target: string
  recordType: DnsRecordType | null
  serverId: string | null
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

function getAppHostTarget() {
  try {
    const host = new URL(config.APP_URL).hostname.trim()
    return host && host !== 'localhost' ? host : null
  } catch {
    return null
  }
}

function getServerRoutingTarget(serverIp: string | null | undefined) {
  const normalizedServerIp = normalizeConfigValue(serverIp)
  if (normalizedServerIp && normalizedServerIp !== '127.0.0.1' && normalizedServerIp !== '::1') {
    return normalizedServerIp
  }

  return getAppHostTarget() ?? normalizedServerIp ?? ''
}

export async function resolveCustomDomainRoutingForServer(serverId: string | null | undefined): Promise<CustomDomainRoutingConfig> {
  if (serverId) {
    const [server] = await db
      .select({ id: servers.id, ipAddress: servers.ipAddress })
      .from(servers)
      .where(and(eq(servers.id, serverId), isNull(servers.deletedAt)))
      .limit(1)

    const target = getServerRoutingTarget(server?.ipAddress)
    if (target) {
      return {
        mode: 'server',
        target,
        recordType: inferRecordType(target),
        serverId,
      }
    }
  }

  return {
    mode: 'disabled',
    target: '',
    recordType: null,
    serverId: serverId ?? null,
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
