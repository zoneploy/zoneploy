type StackLike = {
  id: string
  serverId: string | null
  projectName: string
}

type CleanupDeps<TServer> = {
  getServer: (serverId: string) => Promise<TServer | null>
  purgeRuntime: (server: TServer, stackId: string, projectName: string) => Promise<unknown>
  clearRedisRoutes: (stackId: string) => Promise<unknown>
  softDeleteAddOnBindings: (stackId: string) => Promise<unknown>
  softDeleteZoneployEndpoints: (stackId: string) => Promise<unknown>
  softDeleteCustomEndpoints: (stackId: string) => Promise<unknown>
  softDelete: (stackId: string) => Promise<unknown>
}

export async function deleteStackWithDeps<TServer>(
  stack: StackLike,
  deps: CleanupDeps<TServer>,
) {
  if (stack.serverId) {
    const server = await deps.getServer(stack.serverId)
    if (server) {
      await deps.purgeRuntime(server, stack.id, stack.projectName).catch(() => null)
    }
  }

  await Promise.all([
    deps.softDelete(stack.id),
    deps.softDeleteAddOnBindings(stack.id),
    deps.softDeleteZoneployEndpoints(stack.id),
    deps.softDeleteCustomEndpoints(stack.id),
    deps.clearRedisRoutes(stack.id),
  ])
}
