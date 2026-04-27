import type { CustomDomainRoutingMode } from '../../lib/custom-domain-routing.js'
import { getZoneployFullDomain, getZoneployRouterSubdomain } from '../../lib/public-endpoints.js'

type ZoneployEndpointLike = {
  hostnameLabel: string
  port: number
  isPrimary: boolean
}

type CustomEndpointLike = {
  hostname: string
  port: number
  verified: boolean
  isPrimary: boolean
}

export function buildContainerPortMappings(
  zoneployRows: ZoneployEndpointLike[],
  customRows: CustomEndpointLike[],
) {
  const grouped = new Map<number, {
    port: number
    isPrimary: boolean
    zoneploySubdomains: string[]
    customDomains: string[]
  }>()

  for (const endpoint of zoneployRows) {
    const bucket = grouped.get(endpoint.port) ?? {
      port: endpoint.port,
      isPrimary: false,
      zoneploySubdomains: [],
      customDomains: [],
    }
    bucket.zoneploySubdomains.push(getZoneployRouterSubdomain('container', endpoint.hostnameLabel))
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(endpoint.port, bucket)
  }

  for (const endpoint of customRows) {
    const bucket = grouped.get(endpoint.port) ?? {
      port: endpoint.port,
      isPrimary: false,
      zoneploySubdomains: [],
      customDomains: [],
    }
    if (endpoint.verified) {
      bucket.customDomains.push(endpoint.hostname)
    }
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(endpoint.port, bucket)
  }

  return Array.from(grouped.values())
    .filter(mapping => mapping.zoneploySubdomains.length > 0 || mapping.customDomains.length > 0)
    .sort((a, b) => a.port - b.port)
}

export function buildContainerGatewayRouteTarget(input: {
  ipAddress: string
  httpsEnabled: boolean
  targetPort?: number
}) {
  return JSON.stringify({
    ip: input.ipAddress,
    port: input.targetPort ?? (input.httpsEnabled ? 443 : 8899),
  })
}

export function buildContainerRedisRouteWrites(input: {
  zoneployRows: ZoneployEndpointLike[]
  customRows: CustomEndpointLike[]
  routeTarget: string
  customDomainRoutingMode: CustomDomainRoutingMode
}) {
  const writes = input.zoneployRows.map(endpoint => ({
    hostname: getZoneployFullDomain('container', endpoint.hostnameLabel),
    target: input.routeTarget,
  }))

  if (input.customDomainRoutingMode === 'platform') {
    for (const endpoint of input.customRows) {
      if (endpoint.verified) {
        writes.push({ hostname: endpoint.hostname, target: input.routeTarget })
      }
    }
  }

  return writes
}
