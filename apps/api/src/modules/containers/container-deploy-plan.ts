import type { CustomDomainRoutingMode } from '../../lib/custom-domain-routing.js'

type CustomEndpointLike = {
  hostname: string
  port: number
  verified: boolean
  isPrimary: boolean
}

export function buildContainerPortMappings(
  customRows: CustomEndpointLike[],
) {
  const grouped = new Map<number, {
    port: number
    isPrimary: boolean
    customDomains: string[]
  }>()

  for (const endpoint of customRows) {
    const bucket = grouped.get(endpoint.port) ?? {
      port: endpoint.port,
      isPrimary: false,
      customDomains: [],
    }
    if (endpoint.verified) {
      bucket.customDomains.push(endpoint.hostname)
    }
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(endpoint.port, bucket)
  }

  return Array.from(grouped.values())
    .filter(mapping => mapping.customDomains.length > 0)
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
  customRows: CustomEndpointLike[]
  routeTarget: string
  customDomainRoutingMode: CustomDomainRoutingMode
}) {
  const writes: Array<{ hostname: string; target: string }> = []

  if (input.customDomainRoutingMode === 'server') {
    for (const endpoint of input.customRows) {
      if (endpoint.verified) {
        writes.push({ hostname: endpoint.hostname, target: input.routeTarget })
      }
    }
  }

  return writes
}
