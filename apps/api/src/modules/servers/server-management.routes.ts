import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Permission } from '@zoneploy/types'
import { authenticate as defaultAuthenticate } from '../../plugins/authenticate.js'
import { authorize as defaultAuthorize } from '../../plugins/authorize.js'
import {
  cleanupServerDocker as defaultCleanupServerDocker,
  getServerAgentAudit as defaultGetServerAgentAudit,
  getServer as defaultGetServer,
  listServers as defaultListServers,
} from './servers.service.js'
import { audit as defaultAudit } from '../../lib/audit.js'
import { handleServerRouteError } from './server-route-errors.js'

interface ServerManagementRouteDeps {
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  authorize?: typeof defaultAuthorize
  listServers?: typeof defaultListServers
  getServer?: typeof defaultGetServer
  cleanupServerDocker?: typeof defaultCleanupServerDocker
  getServerAgentAudit?: typeof defaultGetServerAgentAudit
  audit?: typeof defaultAudit
}

export async function serverManagementRoutes(
  app: FastifyInstance,
  options: { deps?: ServerManagementRouteDeps } = {},
) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    listServers: defaultListServers,
    getServer: defaultGetServer,
    cleanupServerDocker: defaultCleanupServerDocker,
    getServerAgentAudit: defaultGetServerAgentAudit,
    audit: defaultAudit,
    ...options.deps,
  }
  const allow = (permission: Permission, fallbackRole: Parameters<typeof defaultAuthorize>[0]) =>
    deps.authorize.permission?.(permission) ?? deps.authorize(fallbackRole)

  app.get(
    '/',
    { preHandler: [deps.authenticate, allow('servers:read', 'viewer')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }
      try {
        return reply.send(await deps.listServers(orgId))
      } catch (error) {
        return handleServerRouteError(reply, error)
      }
    },
  )

  app.get(
    '/:serverId',
    { preHandler: [deps.authenticate, allow('servers:read', 'viewer')] },
    async (request, reply) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }
      try {
        return reply.send(await deps.getServer(orgId, serverId))
      } catch (error) {
        return handleServerRouteError(reply, error)
      }
    },
  )

  app.post(
    '/:serverId/docker-cleanup',
    { preHandler: [deps.authenticate, allow('servers:connect', 'admin')] },
    async (request, reply) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }
      const body = request.body as {
        dryRun?: boolean
        olderThanHours?: number
        pruneStoppedContainers?: boolean
        pruneDanglingImages?: boolean
        pruneBuildCache?: boolean
        pruneUnusedNetworks?: boolean
      }

      try {
        const result = await deps.cleanupServerDocker(orgId, serverId, body ?? {})
        const server = await deps.getServer(orgId, serverId).catch(() => null)
        deps.audit({
          orgId,
          actor: { id: request.userId, email: request.userEmail, name: request.userName },
          action: 'server.docker_cleanup',
          resourceType: 'server',
          resourceId: serverId,
          resourceName: server?.name,
          metadata: {
            dryRun: result.dryRun,
            totalReclaimedMb: result.totalReclaimedMb,
            olderThanHours: result.olderThanHours,
          },
          ipAddress: request.ip,
        })
        return reply.send(result)
      } catch (error) {
        return handleServerRouteError(reply, error)
      }
    },
  )

  app.post(
    '/:serverId/audit',
    { preHandler: [deps.authenticate, allow('servers:read', 'viewer')] },
    async (request, reply) => {
      const { orgId, serverId } = request.params as { orgId: string; serverId: string }
      try {
        return reply.send(await deps.getServerAgentAudit(orgId, serverId))
      } catch (error) {
        return handleServerRouteError(reply, error)
      }
    },
  )
}
