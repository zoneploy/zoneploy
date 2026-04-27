import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customPublicEndpoints, zoneployPublicEndpoints } from '../db/schema.js'
import { config } from '../config.js'
import { AppError } from './errors.js'

export type PublicEndpointOwnerType = 'container' | 'stack'

type ZoneployEndpointRow = typeof zoneployPublicEndpoints.$inferSelect
type CustomEndpointRow = typeof customPublicEndpoints.$inferSelect

const RESERVED_ZONEPLOY_SUBDOMAIN_LABELS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'cdn',
  'dashboard',
  'docs',
  'mail',
  'proxy',
  'registry',
  'smtp',
  'static',
  'status',
  'support',
  'www',
])

export function normalizeZoneploySlug(slug: string) {
  return slug.trim().toLowerCase()
}

export function assertValidZoneploySlug(slug: string) {
  const normalized = normalizeZoneploySlug(slug)

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(normalized)) {
    throw new AppError(400, 'INVALID_ZONEPLOY_SLUG', 'Slug must be 3-63 chars, lowercase letters, numbers and hyphens only')
  }

  if (RESERVED_ZONEPLOY_SUBDOMAIN_LABELS.has(normalized)) {
    throw new AppError(409, 'ZONEPLOY_HOSTNAME_RESERVED', `Subdomain ${normalized} is reserved by Zoneploy`)
  }
}

export function generateZoneploySlug() {
  return randomUUID()
}

export function buildZoneployHostnameLabel(ownerType: PublicEndpointOwnerType, slug: string) {
  return ownerType === 'stack' ? slug : `${slug}${config.SUBDOMAIN_SUFFIX}`
}

export function getZoneployRouterSubdomain(ownerType: PublicEndpointOwnerType, hostnameLabel: string) {
  return ownerType === 'stack'
    ? `${hostnameLabel}${config.SUBDOMAIN_SUFFIX}`
    : hostnameLabel
}

export function getZoneployFullDomain(ownerType: PublicEndpointOwnerType, hostnameLabel: string) {
  return `${getZoneployRouterSubdomain(ownerType, hostnameLabel)}.${config.ROUTING_DOMAIN}`
}

export async function listZoneployEndpoints(ownerType: PublicEndpointOwnerType, ownerId: string) {
  return db
    .select()
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.ownerType, ownerType),
      eq(zoneployPublicEndpoints.ownerId, ownerId),
      isNull(zoneployPublicEndpoints.deletedAt),
    ))
    .orderBy(desc(zoneployPublicEndpoints.isPrimary), asc(zoneployPublicEndpoints.createdAt))
}

export async function listCustomEndpoints(ownerType: PublicEndpointOwnerType, ownerId: string) {
  return db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.ownerType, ownerType),
      eq(customPublicEndpoints.ownerId, ownerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .orderBy(desc(customPublicEndpoints.isPrimary), asc(customPublicEndpoints.createdAt))
}

export async function clearPrimaryPublicEndpoints(ownerType: PublicEndpointOwnerType, ownerId: string) {
  await Promise.all([
    db
      .update(zoneployPublicEndpoints)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(
        eq(zoneployPublicEndpoints.ownerType, ownerType),
        eq(zoneployPublicEndpoints.ownerId, ownerId),
        isNull(zoneployPublicEndpoints.deletedAt),
      )),
    db
      .update(customPublicEndpoints)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(
        eq(customPublicEndpoints.ownerType, ownerType),
        eq(customPublicEndpoints.ownerId, ownerId),
        isNull(customPublicEndpoints.deletedAt),
      )),
  ])
}

export async function promoteNextPrimaryPublicEndpoint(ownerType: PublicEndpointOwnerType, ownerId: string) {
  const [customRows, zoneployRows] = await Promise.all([
    listCustomEndpoints(ownerType, ownerId),
    listZoneployEndpoints(ownerType, ownerId),
  ])

  const preferredCustom = customRows.find(row => row.verified) ?? customRows[0] ?? null
  const candidate = preferredCustom
    ? { kind: 'custom' as const, id: preferredCustom.id }
    : zoneployRows[0]
      ? { kind: 'zoneploy' as const, id: zoneployRows[0].id }
      : null

  if (!candidate) return null

  if (candidate.kind === 'custom') {
    await db
      .update(customPublicEndpoints)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(and(eq(customPublicEndpoints.id, candidate.id), isNull(customPublicEndpoints.deletedAt)))
  } else {
    await db
      .update(zoneployPublicEndpoints)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(and(eq(zoneployPublicEndpoints.id, candidate.id), isNull(zoneployPublicEndpoints.deletedAt)))
  }

  return candidate
}

export function getPreferredPublicHost(
  ownerType: PublicEndpointOwnerType,
  zoneployRows: ZoneployEndpointRow[],
  customRows: CustomEndpointRow[],
) {
  const primaryVerifiedCustom = customRows.find(row => row.isPrimary && row.verified)
  if (primaryVerifiedCustom) {
    return {
      hostname: primaryVerifiedCustom.hostname,
      kind: 'custom' as const,
      verified: true,
    }
  }

  const anyVerifiedCustom = customRows.find(row => row.verified)
  if (anyVerifiedCustom) {
    return {
      hostname: anyVerifiedCustom.hostname,
      kind: 'custom' as const,
      verified: true,
    }
  }

  const primaryZoneploy = zoneployRows.find(row => row.isPrimary)
  if (primaryZoneploy) {
    return {
      hostname: getZoneployFullDomain(ownerType, primaryZoneploy.hostnameLabel),
      kind: 'zoneploy' as const,
      verified: true,
    }
  }

  const firstZoneploy = zoneployRows[0]
  if (firstZoneploy) {
    return {
      hostname: getZoneployFullDomain(ownerType, firstZoneploy.hostnameLabel),
      kind: 'zoneploy' as const,
      verified: true,
    }
  }

  const primaryCustom = customRows.find(row => row.isPrimary)
  if (primaryCustom) {
    return {
      hostname: primaryCustom.hostname,
      kind: 'custom' as const,
      verified: false,
    }
  }

  const firstCustom = customRows[0]
  if (firstCustom) {
    return {
      hostname: firstCustom.hostname,
      kind: 'custom' as const,
      verified: false,
    }
  }

  return null
}
