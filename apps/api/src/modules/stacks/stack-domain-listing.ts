type ServerLike = {
  status: string
}

type ResolvePublicEndpointResult = {
  resolvedServiceName: string | null
  portResolved: boolean
}

type StackListingDeps<TStack, TServer extends ServerLike, TCustomRow, TRouting, TCustomItem, TRoutingPayload> = {
  syncRuntime: (stackId: string) => Promise<unknown>
  resolveRouting: (stackId: string) => Promise<TRouting>
  getServer: (serverId: string) => Promise<TServer | null>
  listCustomRows: (stackId: string) => Promise<TCustomRow[]>
  resolvePublicEndpoint: (stack: TStack, port: number, server?: TServer | null) => Promise<ResolvePublicEndpointResult>
  formatCustomEndpoint: (endpoint: TCustomRow, routing: TRouting) => TCustomItem
  formatCustomRouting: (routing: TRouting) => TRoutingPayload
}

export async function listStackDomainsWithDeps<TStack extends { serverId: string | null }, TServer extends ServerLike, TCustomRow extends { port: number }, TRouting, TCustomItem extends object, TRoutingPayload>(
  stackId: string,
  stack: TStack,
  deps: StackListingDeps<TStack, TServer, TCustomRow, TRouting, TCustomItem, TRoutingPayload>,
) {
  await deps.syncRuntime(stackId).catch(() => false)

  const [routing, server, customRows] = await Promise.all([
    deps.resolveRouting(stackId),
    stack.serverId ? deps.getServer(stack.serverId) : Promise.resolve(null),
    deps.listCustomRows(stackId),
  ])

  const runtimeServer = server?.status === 'online' ? server : null
  const custom = await Promise.all(customRows.map(async (endpoint) => {
    const resolved = await deps.resolvePublicEndpoint(stack, endpoint.port, runtimeServer)
    return {
      ...deps.formatCustomEndpoint(endpoint, routing),
      resolvedServiceName: resolved.resolvedServiceName,
      portResolved: resolved.portResolved,
    }
  }))

  return {
    custom,
    customRouting: deps.formatCustomRouting(routing),
  }
}
