type ContainerCustomEndpointLike = {
  port: number
  hostname: string
  verified: boolean
  isPrimary: boolean
}

export type ContainerPortMapping = {
  port: number
  isPrimary: boolean
  customDomains: string[]
}

type ContainerRuntimeLike = {
  serverId: string | null
  dockerId: string | null
}

type ServerRuntimeLike = {
  status: string
  agentMode?: string | null
}

type SyncContainerRoutesDeps = {
  getContainer: (containerId: string) => Promise<ContainerRuntimeLike | null | undefined>
  getServer: (serverId: string) => Promise<ServerRuntimeLike | null | undefined>
  buildPortMappings: (containerId: string) => Promise<ContainerPortMapping[]>
  syncRoutes: (server: ServerRuntimeLike, payload: { containerId: string; nameOrId: string; platformDomain: string; portMappings: ContainerPortMapping[] }) => Promise<void>
  syncRedis: (containerId: string) => Promise<void>
  markNeedsRedeploy: (containerId: string) => Promise<void>
  clearNeedsRedeploy: (containerId: string) => Promise<void>
  platformDomain: string
}

export function buildContainerPortMappingsFromEndpoints(
  customRows: ContainerCustomEndpointLike[],
) {
  const grouped = new Map<number, ContainerPortMapping>()

  for (const endpoint of customRows) {
    if (!endpoint.verified) continue

    const bucket = grouped.get(endpoint.port) ?? {
      port: endpoint.port,
      isPrimary: false,
      customDomains: [],
    }
    bucket.customDomains.push(endpoint.hostname)
    bucket.isPrimary = bucket.isPrimary || endpoint.isPrimary
    grouped.set(endpoint.port, bucket)
  }

  return Array.from(grouped.values())
    .filter(mapping => mapping.customDomains.length > 0)
    .sort((a, b) => a.port - b.port)
}

export async function syncContainerRuntimeRoutesWithDeps(containerId: string, deps: SyncContainerRoutesDeps) {
  const container = await deps.getContainer(containerId)

  if (!container?.serverId || !container.dockerId) {
    await deps.markNeedsRedeploy(containerId)
    return false
  }

  const server = await deps.getServer(container.serverId)

  if (!server || (server.status !== 'online' && server.agentMode !== 'self_hosted')) {
    await deps.markNeedsRedeploy(containerId)
    return false
  }

  try {
    const portMappings = await deps.buildPortMappings(containerId)
    await deps.syncRoutes(server, {
      containerId,
      nameOrId: container.dockerId,
      platformDomain: deps.platformDomain,
      portMappings,
    })
    await deps.syncRedis(containerId)
    await deps.clearNeedsRedeploy(containerId)
    return true
  } catch {
    await deps.markNeedsRedeploy(containerId)
    return false
  }
}
