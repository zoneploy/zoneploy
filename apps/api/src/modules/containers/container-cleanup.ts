import { getZoneployFullDomain } from '../../lib/public-endpoints.js'

type ContainerLike = {
  id: string
  serverId: string | null
  dockerId: string | null
  status: string
}

type ZoneployEndpointLike = {
  hostnameLabel: string
}

type CustomEndpointLike = {
  hostname: string
}

type CleanupDeps<TServer, TZoneployRow extends ZoneployEndpointLike, TCustomRow extends CustomEndpointLike> = {
  getServer: (serverId: string) => Promise<TServer | null>
  stopContainer: (server: TServer, dockerId: string) => Promise<unknown>
  clearRuntimeRoutes: (server: TServer, containerId: string) => Promise<unknown>
  listZoneployRows: (containerId: string) => Promise<TZoneployRow[]>
  listCustomRows: (containerId: string) => Promise<TCustomRow[]>
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  deleteSecrets: (containerId: string) => Promise<unknown>
  softDeleteAddOnBindings: (containerId: string) => Promise<unknown>
  softDeleteZoneployEndpoints: (containerId: string) => Promise<unknown>
  softDeleteCustomEndpoints: (containerId: string) => Promise<unknown>
  softDelete: (containerId: string) => Promise<unknown>
}

export async function deleteContainerWithDeps<TServer, TZoneployRow extends ZoneployEndpointLike, TCustomRow extends CustomEndpointLike>(
  container: ContainerLike,
  deps: CleanupDeps<TServer, TZoneployRow, TCustomRow>,
) {
  if (container.serverId && container.dockerId) {
    const server = await deps.getServer(container.serverId)
    if (server) {
      if (container.status === 'running') {
        await deps.stopContainer(server, container.dockerId).catch(() => null)
      }
      await deps.clearRuntimeRoutes(server, container.id).catch(() => null)
    }
  }

  const [zoneployRows, customRows] = await Promise.all([
    deps.listZoneployRows(container.id),
    deps.listCustomRows(container.id),
  ])

  await deps.removeHostsFromRedis([
    ...zoneployRows.map(endpoint => getZoneployFullDomain('container', endpoint.hostnameLabel)),
    ...customRows.map(endpoint => endpoint.hostname),
  ])

  await Promise.all([
    deps.deleteSecrets(container.id),
    deps.softDeleteAddOnBindings(container.id),
    deps.softDeleteZoneployEndpoints(container.id),
    deps.softDeleteCustomEndpoints(container.id),
  ])

  await deps.softDelete(container.id)
}
