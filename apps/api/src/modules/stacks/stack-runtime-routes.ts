import { getZoneployRouterSubdomain } from '../../lib/public-endpoints.js'

type StackLike = {
  id: string
  projectName: string
  composeContent: string | null
  serverId: string | null
  deletedAt?: Date | null
}

type ServerStatusLike = {
  status: string
}

type StackZoneployEndpointLike = {
  id: string
  port: number
  hostnameLabel: string
  isPrimary: boolean
}

type StackCustomEndpointLike = {
  id: string
  port: number
  hostname: string
  verified: boolean
  isPrimary: boolean
}

type ResolvedStackEndpoint = {
  resolvedServiceName: string | null
  portResolved: boolean
}

export type StackDomainMapping = {
  id: string
  serviceName: string
  port: number
  zoneploySubdomains: string[]
  customDomains: string[]
  isPrimary: boolean
}

type BuildStackRouteMappingsDeps<ServerT = unknown> = {
  listZoneployRows: (stackId: string) => Promise<StackZoneployEndpointLike[]>
  listCustomRows: (stackId: string) => Promise<StackCustomEndpointLike[]>
  resolvePublicEndpoint: (
    stack: Pick<StackLike, 'id' | 'projectName' | 'composeContent'>,
    port: number,
    server?: ServerT | null,
    composeContentOverride?: string | null,
  ) => Promise<ResolvedStackEndpoint>
}

type SyncStackRuntimeRoutesDeps<ServerT extends ServerStatusLike = ServerStatusLike> = {
  getStack: (stackId: string) => Promise<StackLike | null | undefined>
  getServer: (serverId: string) => Promise<ServerT | null | undefined>
  buildRouteMappings: (stack: Pick<StackLike, 'id' | 'projectName' | 'composeContent'>, server?: ServerT | null) => Promise<StackDomainMapping[]>
  syncRoutes: (server: ServerT, payload: { stackId: string; projectName: string; platformDomain: string; domainMappings: StackDomainMapping[] }) => Promise<void>
  syncRedis: (stackId: string) => Promise<void>
  platformDomain: string
}

export async function buildStackRouteMappingsWithDeps<ServerT = unknown>(
  stack: Pick<StackLike, 'id' | 'projectName' | 'composeContent'>,
  deps: BuildStackRouteMappingsDeps<ServerT>,
  server?: ServerT | null,
  composeContentOverride?: string | null,
) {
  const [zoneployRows, customRows] = await Promise.all([
    deps.listZoneployRows(stack.id),
    deps.listCustomRows(stack.id),
  ])

  const grouped = new Map<string, StackDomainMapping>()

  for (const endpoint of zoneployRows) {
    const resolved = await deps.resolvePublicEndpoint(stack, endpoint.port, server, composeContentOverride)
    if (!resolved.resolvedServiceName) continue

    const key = `${resolved.resolvedServiceName}:${endpoint.port}`
    const bucket = grouped.get(key) ?? {
      id: endpoint.id,
      serviceName: resolved.resolvedServiceName,
      port: endpoint.port,
      zoneploySubdomains: [],
      customDomains: [],
      isPrimary: false,
    }
    bucket.zoneploySubdomains.push(getZoneployRouterSubdomain('stack', endpoint.hostnameLabel))
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(key, bucket)
  }

  for (const endpoint of customRows) {
    if (!endpoint.verified) continue

    const resolved = await deps.resolvePublicEndpoint(stack, endpoint.port, server, composeContentOverride)
    if (!resolved.resolvedServiceName) continue

    const key = `${resolved.resolvedServiceName}:${endpoint.port}`
    const bucket = grouped.get(key) ?? {
      id: endpoint.id,
      serviceName: resolved.resolvedServiceName,
      port: endpoint.port,
      zoneploySubdomains: [],
      customDomains: [],
      isPrimary: false,
    }
    bucket.customDomains.push(endpoint.hostname)
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(key, bucket)
  }

  return Array.from(grouped.values()).filter(mapping => mapping.zoneploySubdomains.length > 0 || mapping.customDomains.length > 0)
}

export async function syncStackRuntimeRoutesWithDeps<ServerT extends ServerStatusLike = ServerStatusLike>(stackId: string, deps: SyncStackRuntimeRoutesDeps<ServerT>) {
  const stack = await deps.getStack(stackId)

  if (!stack?.serverId || stack.deletedAt) return false

  const server = await deps.getServer(stack.serverId)
  if (!server || server.status !== 'online') return false

  try {
    const domainMappings = await deps.buildRouteMappings(stack, server)
    await deps.syncRoutes(server, {
      stackId: stack.id,
      projectName: stack.projectName,
      platformDomain: deps.platformDomain,
      domainMappings,
    })
    await deps.syncRedis(stack.id)
    return true
  } catch {
    return false
  }
}
