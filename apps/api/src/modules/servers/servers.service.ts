import { and, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ServerPreflightReport } from '@zoneploy/types'
import { collectPreflightReport } from '@zoneploy/runtime'
import { db } from '../../db/client.js'
import { servers } from '../../db/schema.js'
import { encrypt } from '../../lib/crypto.js'
import { AppError, NotFoundError } from '../../lib/errors.js'
import { workerClient } from '../../lib/worker-client.js'
import type { AgentDockerCleanupOptions, AgentDockerCleanupResult } from '../../lib/worker-client.js'

type ServerRow = typeof servers.$inferSelect

function normalizeServerSnapshot(server: ServerRow) {
  return {
    id: server.id,
    orgId: server.orgId,
    name: server.name,
    ipAddress: server.ipAddress,
    sshUser: server.sshUser,
    sshPort: server.sshPort,
    agentPort: server.agentPort,
    agentMode: server.agentMode,
    status: server.status,
    lastHeartbeatAt: server.lastHeartbeatAt,
    totalCpuCores: server.totalCpuCores,
    totalMemoryMb: server.totalMemoryMb,
    totalStorageMb: server.totalStorageMb,
    agentVersion: server.agentVersion,
    runtimeInfo: (server.runtimeInfo ?? {}) as Record<string, unknown>,
    capabilities: (server.capabilities ?? {}) as Record<string, unknown>,
    conflicts: Array.isArray(server.conflicts) ? server.conflicts : [],
    lastPreflightAt: server.lastPreflightAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

function preflightUpdate(preflight: ServerPreflightReport) {
  return {
    runtimeInfo: preflight.runtimeInfo,
    capabilities: preflight.capabilities,
    conflicts: preflight.conflicts,
    lastPreflightAt: new Date(preflight.checkedAt),
    totalCpuCores: preflight.runtimeInfo.totalCpuCores,
    totalMemoryMb: preflight.runtimeInfo.totalMemoryMb,
    totalStorageMb: preflight.runtimeInfo.totalStorageMb,
  }
}

async function ensureLocalServer(orgId: string) {
  const [existing] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.orgId, orgId), isNull(servers.deletedAt)))
    .orderBy(servers.createdAt)
    .limit(1)

  if (existing) {
    const hasPreflightData =
      existing.lastPreflightAt != null &&
      typeof existing.runtimeInfo === 'object' &&
      existing.runtimeInfo != null &&
      Object.keys(existing.runtimeInfo as Record<string, unknown>).length > 0

    if (existing.agentMode === 'self_hosted') {
      if (hasPreflightData && existing.status === 'online') return existing

      const preflight = hasPreflightData ? null : await collectPreflightReport()
      const [updated] = await db
        .update(servers)
        .set({
          status: 'online',
          lastHeartbeatAt: new Date(),
          ...(preflight ? preflightUpdate(preflight) : {}),
          updatedAt: new Date(),
        })
        .where(eq(servers.id, existing.id))
        .returning()

      if (updated) return updated
      return existing
    }

    if (hasPreflightData) return existing

    const preflight = await collectPreflightReport()
    const [updated] = await db
      .update(servers)
      .set({
        status: 'online',
        lastHeartbeatAt: new Date(),
        ...preflightUpdate(preflight),
        updatedAt: new Date(),
      })
      .where(eq(servers.id, existing.id))
      .returning()

    if (updated) return updated
    return existing
  }

  const token = encrypt(`local-${nanoid(32)}`)
  const preflight = await collectPreflightReport()
  const [created] = await db
    .insert(servers)
    .values({
      orgId,
      name: 'Local VPS',
      ipAddress: '127.0.0.1',
      sshUser: 'root',
      sshPort: 22,
      agentPort: 0,
      agentMode: 'self_hosted',
      agentTokenEncrypted: token.encrypted,
      agentTokenIv: token.iv,
      agentTokenAuthTag: token.authTag,
      status: 'online',
      lastHeartbeatAt: new Date(),
      ...preflightUpdate(preflight),
    })
    .returning()

  if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create the local server record')
  return created
}

async function getServerRow(orgId: string, serverId: string) {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.orgId, orgId), isNull(servers.deletedAt)))
    .limit(1)

  if (!server) throw new NotFoundError('Server not found')
  return server
}

export async function listServers(orgId: string) {
  await ensureLocalServer(orgId)
  const result = await db
    .select()
    .from(servers)
    .where(and(eq(servers.orgId, orgId), isNull(servers.deletedAt)))
    .orderBy(servers.createdAt)

  return result.map(normalizeServerSnapshot)
}

export async function getServer(orgId: string, serverId: string) {
  return normalizeServerSnapshot(await getServerRow(orgId, serverId))
}

export async function getServerAgentAudit(orgId: string, serverId: string) {
  const server = await getServerRow(orgId, serverId)
  return workerClient.audit(server)
}

export async function cleanupServerDocker(
  orgId: string,
  serverId: string,
  options: AgentDockerCleanupOptions,
): Promise<AgentDockerCleanupResult> {
  const server = await getServerRow(orgId, serverId)
  return workerClient.dockerCleanup(server, options)
}
