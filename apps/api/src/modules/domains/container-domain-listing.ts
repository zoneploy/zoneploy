type ListingDeps<TCustomRow, TRouting, TCustomItem, TRoutingPayload> = {
  syncRuntime: (containerId: string) => Promise<unknown>
  resolveRouting: (containerId: string) => Promise<TRouting>
  listCustomRows: (containerId: string) => Promise<TCustomRow[]>
  formatCustomEndpoint: (endpoint: TCustomRow, routing: TRouting) => TCustomItem
  formatCustomRouting: (routing: TRouting) => TRoutingPayload
}

export async function listContainerDomainsWithDeps<TCustomRow, TRouting, TCustomItem, TRoutingPayload>(
  containerId: string,
  deps: ListingDeps<TCustomRow, TRouting, TCustomItem, TRoutingPayload>,
) {
  await deps.syncRuntime(containerId).catch(() => false)

  const [routing, customRows] = await Promise.all([
    deps.resolveRouting(containerId),
    deps.listCustomRows(containerId),
  ])

  return {
    custom: customRows.map(endpoint => deps.formatCustomEndpoint(endpoint, routing)),
    customRouting: deps.formatCustomRouting(routing),
  }
}
