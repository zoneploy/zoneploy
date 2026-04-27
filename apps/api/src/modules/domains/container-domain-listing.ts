type ListingDeps<TZoneployRow, TCustomRow, TRouting, TZoneployItem, TCustomItem, TRoutingPayload> = {
  syncRuntime: (containerId: string) => Promise<unknown>
  resolveRouting: (containerId: string) => Promise<TRouting>
  listZoneployRows: (containerId: string) => Promise<TZoneployRow[]>
  listCustomRows: (containerId: string) => Promise<TCustomRow[]>
  formatZoneployEndpoint: (endpoint: TZoneployRow) => TZoneployItem
  formatCustomEndpoint: (endpoint: TCustomRow, routing: TRouting) => TCustomItem
  formatCustomRouting: (routing: TRouting) => TRoutingPayload
}

export async function listContainerDomainsWithDeps<TZoneployRow, TCustomRow, TRouting, TZoneployItem, TCustomItem, TRoutingPayload>(
  containerId: string,
  deps: ListingDeps<TZoneployRow, TCustomRow, TRouting, TZoneployItem, TCustomItem, TRoutingPayload>,
) {
  await deps.syncRuntime(containerId).catch(() => false)

  const [routing, zoneployRows, customRows] = await Promise.all([
    deps.resolveRouting(containerId),
    deps.listZoneployRows(containerId),
    deps.listCustomRows(containerId),
  ])

  return {
    zoneploy: zoneployRows.map(deps.formatZoneployEndpoint),
    custom: customRows.map(endpoint => deps.formatCustomEndpoint(endpoint, routing)),
    customRouting: deps.formatCustomRouting(routing),
  }
}
