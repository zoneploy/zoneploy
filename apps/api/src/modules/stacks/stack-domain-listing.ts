type ServerLike = {
  status: string
}

type ResolvePublicEndpointResult = {
  resolvedServiceName: string | null
  portResolved: boolean
}

type StackListingDeps<TStack, TServer extends ServerLike, TZoneployRow, TCustomRow, TRouting, TZoneployItem, TCustomItem, TRoutingPayload> = {
  syncRuntime: (stackId: string) => Promise<unknown>
  resolveRouting: (stackId: string) => Promise<TRouting>
  getServer: (serverId: string) => Promise<TServer | null>
  listZoneployRows: (stackId: string) => Promise<TZoneployRow[]>
  listCustomRows: (stackId: string) => Promise<TCustomRow[]>
  resolvePublicEndpoint: (stack: TStack, port: number, server?: TServer | null) => Promise<ResolvePublicEndpointResult>
  formatZoneployEndpoint: (endpoint: TZoneployRow) => TZoneployItem
  formatCustomEndpoint: (endpoint: TCustomRow, routing: TRouting) => TCustomItem
  formatCustomRouting: (routing: TRouting) => TRoutingPayload
}

export async function listStackDomainsWithDeps<TStack extends { serverId: string | null }, TServer extends ServerLike, TZoneployRow extends { port: number }, TCustomRow extends { port: number }, TRouting, TZoneployItem extends object, TCustomItem extends object, TRoutingPayload>(
  stackId: string,
  stack: TStack,
  deps: StackListingDeps<TStack, TServer, TZoneployRow, TCustomRow, TRouting, TZoneployItem, TCustomItem, TRoutingPayload>,
) {
  await deps.syncRuntime(stackId).catch(() => false)

  const [routing, server, zoneployRows, customRows] = await Promise.all([
    deps.resolveRouting(stackId),
    stack.serverId ? deps.getServer(stack.serverId) : Promise.resolve(null),
    deps.listZoneployRows(stackId),
    deps.listCustomRows(stackId),
  ])

  const runtimeServer = server?.status === 'online' ? server : null
  const [zoneploy, custom] = await Promise.all([
    Promise.all(zoneployRows.map(async (endpoint) => {
      const resolved = await deps.resolvePublicEndpoint(stack, endpoint.port, runtimeServer)
      return {
        ...deps.formatZoneployEndpoint(endpoint),
        resolvedServiceName: resolved.resolvedServiceName,
        portResolved: resolved.portResolved,
      }
    })),
    Promise.all(customRows.map(async (endpoint) => {
      const resolved = await deps.resolvePublicEndpoint(stack, endpoint.port, runtimeServer)
      return {
        ...deps.formatCustomEndpoint(endpoint, routing),
        resolvedServiceName: resolved.resolvedServiceName,
        portResolved: resolved.portResolved,
      }
    })),
  ])

  return {
    zoneploy,
    custom,
    customRouting: deps.formatCustomRouting(routing),
  }
}
