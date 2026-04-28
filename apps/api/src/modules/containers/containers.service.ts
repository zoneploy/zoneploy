import { eq, and, count, isNull, desc } from 'drizzle-orm'
import { pruneDeploymentHistory } from '../../lib/cleanup.js'
import { db } from '../../db/client.js'
import {
  containers,
  servers,
  containerSecrets,
  containerDeployments,
  addOnBindings,
  customPublicEndpoints,
  environments,
  projects,
} from '../../db/schema.js'
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '../../lib/errors.js'
import { generateSlug } from '../../lib/slug.js'
import { getContainerAgentClient } from '../../lib/server-agent-client.js'
import { decrypt } from '../../lib/crypto.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { config } from '../../config.js'
import { generateDeployToken, hashDeployToken } from '../../lib/deploy-token.js'
import { getEnvSecretsDecrypted } from '../environments/environments.service.js'
import type { CreateContainerInput, UpdateContainerInput } from '@zoneploy/types'
import { getAgentAuthToken, getAgentHttpUrl } from '../../lib/worker-client.js'
import type { GitBuildSource } from '../../lib/worker-client.js'
import {
  getPreferredPublicHost,
  listCustomEndpoints,
} from '../../lib/public-endpoints.js'
import { resolveCustomDomainRoutingForServer } from '../../lib/custom-domain-routing.js'
import { deleteContainerWithDeps } from './container-cleanup.js'
import {
  buildContainerGatewayRouteTarget,
  buildContainerPortMappings,
  buildContainerRedisRouteWrites,
} from './container-deploy-plan.js'

// Helpers

function formatContainer(c: typeof containers.$inferSelect) {
  return {
    id: c.id,
    orgId: c.orgId,
    environmentId: c.environmentId,
    serverId: c.serverId,
    name: c.name,
    slug: c.slug,
    image: c.image,
    port: c.port,
    healthcheckPath: c.healthcheckPath,
    status: c.status,
    errorReason: c.errorReason,
    dockerId: c.dockerId,
    currentDeploymentId: c.currentDeploymentId,
    needsRedeploy: c.needsRedeploy,
    hasDeployToken: !!c.deployTokenHash,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

function formatCustomEndpoint(endpoint: typeof customPublicEndpoints.$inferSelect) {
  return {
    id: endpoint.id,
    containerId: endpoint.ownerId,
    port: endpoint.port,
    hostname: endpoint.hostname,
    verified: endpoint.verified,
    isPrimary: endpoint.isPrimary,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  }
}

async function enrichContainer(container: typeof containers.$inferSelect) {
  const [serverRow, customRows, envRow] = await Promise.all([
    container.serverId
      ? db.select({ name: servers.name }).from(servers).where(eq(servers.id, container.serverId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
    listCustomEndpoints('container', container.id),
    container.environmentId
      ? db
          .select({ envName: environments.name, projectName: projects.name })
          .from(environments)
          .innerJoin(projects, eq(environments.projectId, projects.id))
          .where(eq(environments.id, container.environmentId))
          .limit(1)
          .then(r => r[0] ?? null)
      : Promise.resolve(null),
  ])

  const preferredHost = getPreferredPublicHost(customRows)

  return {
    ...formatContainer(container),
    domain: preferredHost
      ? {
          hostname: preferredHost.hostname,
          kind: preferredHost.kind,
          verified: preferredHost.verified,
        }
      : null,
    serverName: serverRow?.name ?? null,
    environmentName: envRow?.envName ?? null,
    projectName: envRow?.projectName ?? null,
  }
}

async function getDefaultServerId(orgId: string) {
  const [server] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.orgId, orgId), isNull(servers.deletedAt)))
    .limit(1)

  if (!server) throw new ValidationError('No local server is available for this organization')
  return server.id
}

// CRUD

export async function listContainers(orgId: string) {
  const result = await db
    .select()
    .from(containers)
    .where(and(eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .orderBy(containers.createdAt)

  return Promise.all(result.map(enrichContainer))
}

export async function getContainer(orgId: string, containerId: string) {
  const [container] = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.id, containerId),
        eq(containers.orgId, orgId),
        isNull(containers.deletedAt),
      ),
    )
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  return enrichContainer(container)
}

export async function createContainer(orgId: string, input: CreateContainerInput) {
  const slug = generateSlug(input.name)

  // Auto-generate deploy token on creation; shown to the user only once.
  const deployToken = generateDeployToken()
  const deployTokenHash = hashDeployToken(deployToken)
  const serverId = input.serverId ?? await getDefaultServerId(orgId)

  const [container] = await db
    .insert(containers)
    .values({
      orgId,
      environmentId: input.environmentId,
      name: input.name,
      slug,
      image: null,  // No initial image; the first deployment comes from CI/CD.
      port: input.port,
      healthcheckPath: input.healthcheckPath,
      serverId,
      status: 'waiting',
      deployTokenHash,
    })
    .returning()

  if (!container) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create the container')

  // Return the raw token; this is the only time it is exposed.
  return { ...formatContainer(container), deployToken }
}

export async function updateContainer(
  orgId: string,
  containerId: string,
  input: UpdateContainerInput,
) {
  const [container] = await db
    .update(containers)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(containers.id, containerId),
        eq(containers.orgId, orgId),
        isNull(containers.deletedAt),
      ),
    )
    .returning()

  if (!container) throw new NotFoundError('Container not found')
  return formatContainer(container)
}

export async function deleteContainer(orgId: string, containerId: string, userId: string) {
  const [container] = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.id, containerId),
        eq(containers.orgId, orgId),
        isNull(containers.deletedAt),
      ),
    )
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  // Try to stop the container on the server if it is running.
  await deleteContainerWithDeps(container, {
    getServer: async (serverId) => {
      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      return server ?? null
    },
    stopContainer: (server, dockerId) => getContainerAgentClient(server as typeof servers.$inferSelect).stopContainer(server as typeof servers.$inferSelect, dockerId),
    clearRuntimeRoutes: (server, id) => getContainerAgentClient(server as typeof servers.$inferSelect).clearContainerRoutes(server as typeof servers.$inferSelect, id),
    listCustomRows: (id) => listCustomEndpoints('container', id),
    removeHostsFromRedis: async (hosts) => {
      for (const host of hosts) {
        await redis.hdel(REDIS_KEYS.routesHash, host)
      }
    },
    deleteSecrets: (id) => db.delete(containerSecrets).where(eq(containerSecrets.containerId, id)),
    softDeleteAddOnBindings: (id) => db
      .update(addOnBindings)
      .set({ status: 'disabled', deletedAt: new Date(), deleteReason: 'container_deleted', updatedAt: new Date() })
      .where(and(eq(addOnBindings.ownerType, 'container'), eq(addOnBindings.ownerId, id), isNull(addOnBindings.deletedAt))),
    softDeleteCustomEndpoints: (id) => db
      .update(customPublicEndpoints)
      .set({ isPrimary: false, verified: false, deletedAt: new Date(), deleteReason: 'container_deleted', updatedAt: new Date() })
      .where(and(eq(customPublicEndpoints.ownerType, 'container'), eq(customPublicEndpoints.ownerId, id), isNull(customPublicEndpoints.deletedAt))),
    softDelete: (id) => db
      .update(containers)
      .set({ deletedAt: new Date(), status: 'stopped', updatedAt: new Date() })
      .where(eq(containers.id, id)),
  })
}

// Deploy

/** Publishes a deploy log entry to Redis (List + pub/sub). */
async function pushDeployLog(
  deploymentId: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
  done = false,
  params?: Record<string, string>,
) {
  const entry = JSON.stringify({ message, level, ts: new Date().toISOString(), done, ...(params && { params }) })
  const key = REDIS_KEYS.deployLogs(deploymentId)
  await redis.rpush(key, entry)
  await redis.expire(key, 7 * 24 * 60 * 60) // 7 day TTL.
  await redis.publish(REDIS_KEYS.deployLogsChannel(deploymentId), entry)
}

export async function deployContainer(
  orgId: string,
  containerId: string,
  userId: string,
  options?: {
    registry?: { registryUser?: string; registryPassword?: string }
    git?: GitBuildSource
    releaseId?: string
  },
) {
  const [container] = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.id, containerId),
        eq(containers.orgId, orgId),
        isNull(containers.deletedAt),
      ),
    )
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')
  if (container.status === 'deploying') throw new ValidationError('The container is already being deployed')
  if (!container.image && !options?.git) throw new ValidationError('The container is waiting for its first deploy. Configure CI/CD and push to start it.')

  const customRows = await listCustomEndpoints('container', containerId)

  const registryUser = options?.registry?.registryUser
  const registryPassword = options?.registry?.registryPassword

  // Load the server manually selected on the container.
  if (!container.serverId) throw new ValidationError('The container does not have a server assigned')
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, container.serverId), eq(servers.orgId, orgId)))
    .limit(1)
  if (!server) throw new NotFoundError('Server not found')
  if (server.status !== 'online' && server.agentMode !== 'self_hosted') {
    throw new AppError(409, 'SERVER_UNAVAILABLE', 'The server is not online')
  }
  const serverId = server.id

  // Load decrypted secrets.
  const containerSecretsRows = await db
    .select()
    .from(containerSecrets)
    .where(eq(containerSecrets.containerId, containerId))

  const envVars: Record<string, string> = container.environmentId
    ? await getEnvSecretsDecrypted(container.environmentId)
    : {}
  for (const secret of containerSecretsRows) {
    envVars[secret.key] = decrypt({
      encrypted: secret.valueEncrypted,
      iv: secret.iv,
      authTag: secret.authTag,
    })
  }

  // Create the deployment record.
  const [deployment] = await db
    .insert(containerDeployments)
    .values({
      containerId,
      orgId,
      serverId,
      imageSnapshot: container.image ?? 'pending-local-build',
      configSnapshot: {
        port: container.port,
        ...(options?.git
          ? {
              git: {
                repository: options.git.repository,
                ref: options.git.ref,
                commitSha: options.git.commitSha,
                contextPath: options.git.contextPath,
                dockerfile: options.git.dockerfile,
              },
            }
          : {}),
      },
      secretKeysSnapshot: Array.from(new Set([
        ...Object.keys(envVars),
        ...containerSecretsRows.map(s => s.key),
      ])),
      triggeredBy: userId,
      status: 'pending',
    })
    .returning()

  if (!deployment) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create the deployment')

  // Prune history: keep only the last 20 container deployments.
  pruneDeploymentHistory(containerId, 20).catch(() => null)

  // Marcar container como deploying
  await db
    .update(containers)
    .set({ status: 'deploying', serverId, updatedAt: new Date() })
    .where(eq(containers.id, containerId))

  // Run deploy asynchronously with log streaming through Redis.
  setImmediate(async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info', done = false, params?: Record<string, string>) =>
      pushDeployLog(deployment.id, msg, level, done, params)

    try {
      await log('deploy.log.starting', 'info', false, { image: container.image ?? 'local-build', server: server.name })
      await db
        .update(containerDeployments)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(containerDeployments.id, deployment.id))

      if (options?.git) {
        await log('deploy.log.building', 'info', false, { repository: options.git.repository })
      } else {
        await log('deploy.log.pulling', 'info', false, { image: container.image! })
      }

      const portMappings = buildContainerPortMappings(customRows)

      let deployedImage: string
      let result: { dockerId: string; imageDigest: string; containerName: string }

      if (options?.git) {
        const gitResult = await getContainerAgentClient(server).buildAndDeploy(server, {
            containerId,
            git: options.git,
            releaseId: options.releaseId,
            port: container.port,
            envVars,
            platformDomain: config.ROUTING_DOMAIN,
            portMappings,
            healthcheckPath: container.healthcheckPath,
          })
        result = gitResult
        deployedImage = gitResult.image
      } else {
        result = await getContainerAgentClient(server).deploy(server, {
            containerId,
            image: container.image!,
            port: container.port,
            envVars,
            platformDomain: config.ROUTING_DOMAIN,
            portMappings,
            healthcheckPath: container.healthcheckPath,
            registryUser,
            registryPassword,
          })
        deployedImage = container.image!
      }

      await log('deploy.log.starting_container', 'info', false, { name: result.containerName })

      await db
        .update(containerDeployments)
        .set({
          status: 'success',
          imageSnapshot: result.imageDigest,
          finishedAt: new Date(),
        })
        .where(eq(containerDeployments.id, deployment.id))

      await db
        .update(containers)
        .set({
          status: 'running',
          image: deployedImage,
          dockerId: result.dockerId,
          currentDeploymentId: deployment.id,
          errorReason: null,
          needsRedeploy: false,
          updatedAt: new Date(),
        })
        .where(eq(containers.id, containerId))

      // Update Redis routing for all container hostnames.
      // Port 443 with HTTPS (gateway SNI forwards to server Traefik), 8899 in development.
      const routeTarget = buildContainerGatewayRouteTarget({
        ipAddress: server.ipAddress,
        httpsEnabled: server.agentMode !== 'self_hosted' && Boolean(config.CERTS_PATH),
        targetPort: server.agentMode === 'self_hosted' ? 80 : undefined,
      })
      const customRouting = await resolveCustomDomainRoutingForServer(server.id)
      const routeWrites = buildContainerRedisRouteWrites({
        customRows,
        routeTarget,
        customDomainRoutingMode: customRouting.mode,
      })
      for (const route of routeWrites) {
        await redis.hset(REDIS_KEYS.routesHash, route.hostname, route.target)
      }

      await log('deploy.log.success', 'info', true, { dockerId: result.dockerId })

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido'

      await db
        .update(containerDeployments)
        .set({ status: 'failed', errorMessage: errorMsg, finishedAt: new Date() })
        .where(eq(containerDeployments.id, deployment.id))

      await db
        .update(containers)
        .set({ status: 'error', errorReason: errorMsg, updatedAt: new Date() })
        .where(eq(containers.id, containerId))

      await log('deploy.log.error', 'error', true, { error: errorMsg })
    }
  })

  return { deploymentId: deployment.id, status: 'pending' }
}

// Deployment history

export async function listDeployments(orgId: string, containerId: string, page = 1, limit = 20) {
  // Verify that the container belongs to the organization.
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  const offset = (page - 1) * limit

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(containerDeployments)
      .where(eq(containerDeployments.containerId, containerId))
      .orderBy(desc(containerDeployments.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(containerDeployments)
      .where(eq(containerDeployments.containerId, containerId)),
  ])

  return {
    data: rows,
    meta: { total: total?.count ?? 0, page, limit, totalPages: Math.ceil((total?.count ?? 0) / limit) },
  }
}

export async function getDeployment(orgId: string, deploymentId: string) {
  const [deployment] = await db
    .select()
    .from(containerDeployments)
    .where(and(eq(containerDeployments.id, deploymentId), eq(containerDeployments.orgId, orgId)))
    .limit(1)

  if (!deployment) throw new NotFoundError('Deployment not found')
  return deployment
}

export async function rollbackDeployment(orgId: string, containerId: string, deploymentId: string, userId: string) {
  const [prev] = await db
    .select()
    .from(containerDeployments)
    .where(and(eq(containerDeployments.id, deploymentId), eq(containerDeployments.containerId, containerId)))
    .limit(1)

  if (!prev) throw new NotFoundError('Deployment not found')
  if (prev.status !== 'success') throw new ValidationError('Only a successful deployment can be rolled back')

  // Update the container image with the previous deployment image and redeploy.
  await db
    .update(containers)
    .set({ image: prev.imageSnapshot, updatedAt: new Date() })
    .where(eq(containers.id, containerId))

  return deployContainer(orgId, containerId, userId)
}

// Metrics

type AgentContainerMetricSample = {
  cpuPercent: number
  memoryUsedMb: number
  diskReadMb?: number
  diskWriteMb?: number
  netRxMb?: number
  netTxMb?: number
  status?: string
  ts?: string
}

const CONTAINER_METRICS_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000
const CONTAINER_METRICS_HISTORY_RETENTION_SECONDS = 24 * 60 * 60
const CONTAINER_METRICS_HISTORY_MAX_POINTS = 1440

function metricTimestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

export async function recordContainerMetricsSample(containerId: string, sample: AgentContainerMetricSample) {
  const ts = metricTimestamp(sample.ts)
  const recordedAt = new Date(ts).toISOString()
  const normalized = {
    cpuPercent: sample.cpuPercent,
    memoryUsedMb: sample.memoryUsedMb,
    diskReadMb: sample.diskReadMb ?? 0,
    diskWriteMb: sample.diskWriteMb ?? 0,
    netRxMb: sample.netRxMb ?? 0,
    netTxMb: sample.netTxMb ?? 0,
    status: sample.status ?? 'running',
    recordedAt,
  }

  await redis.setex(REDIS_KEYS.containerMetrics(containerId), 60, JSON.stringify(normalized))

  const lockKey = REDIS_KEYS.metricsHistoryLock(`container:${containerId}`)
  const canWriteHistory = await redis.set(lockKey, '1', 'NX', 'EX', 60)
  if (canWriteHistory) {
    const histKey = REDIS_KEYS.metricsHistoryContainer(containerId)
    await redis.zadd(histKey, ts, JSON.stringify({
      cpu: normalized.cpuPercent,
      mem: normalized.memoryUsedMb,
      dr: normalized.diskReadMb,
      dw: normalized.diskWriteMb,
      nr: normalized.netRxMb,
      nt: normalized.netTxMb,
      ts,
    }))
    await redis.zremrangebyscore(histKey, '-inf', Date.now() - CONTAINER_METRICS_HISTORY_RETENTION_MS)
    await redis.zremrangebyrank(histKey, 0, -(CONTAINER_METRICS_HISTORY_MAX_POINTS + 1))
    await redis.expire(histKey, CONTAINER_METRICS_HISTORY_RETENTION_SECONDS)
  }

  return normalized
}

export async function getCurrentMetrics(orgId: string, containerId: string) {
  const [container] = await db
    .select({
      id: containers.id,
      dockerId: containers.dockerId,
      serverId: containers.serverId,
    })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  const cached = await redis.get(REDIS_KEYS.containerMetrics(containerId))
  if (cached) return JSON.parse(cached)

  if (container.serverId) {
    const [server] = await db.select().from(servers).where(eq(servers.id, container.serverId)).limit(1)
    if (server && (server.status === 'online' || server.agentMode === 'self_hosted')) {
      const reference = container.dockerId ?? container.id
      const agentRes = await fetch(
        getAgentHttpUrl(server, `/agent/v1/containers/${reference}/metrics/current`),
        {
          headers: { Authorization: `Bearer ${getAgentAuthToken(server)}` },
          signal: AbortSignal.timeout(8_000),
        },
      ).catch(() => null)

      if (agentRes?.ok) {
        return recordContainerMetricsSample(containerId, await agentRes.json() as AgentContainerMetricSample)
      }
    }
  }

  return null
}

export async function getMetricsHistory(orgId: string, containerId: string, period: '1h' | '6h' | '24h') {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  const periodMs = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 }[period]
  const since = Date.now() - periodMs

  const raw = await redis.zrangebyscore(
    REDIS_KEYS.metricsHistoryContainer(containerId),
    since,
    '+inf',
  )

  if (raw.length === 0) {
    const current = await getCurrentMetrics(orgId, containerId)
    if (current && 'cpuPercent' in current) {
      return [{
        cpuPercent: current.cpuPercent,
        memoryUsedMb: current.memoryUsedMb,
        diskReadMb: current.diskReadMb ?? 0,
        diskWriteMb: current.diskWriteMb ?? 0,
        netRxMb: current.netRxMb ?? 0,
        netTxMb: current.netTxMb ?? 0,
        recordedAt: current.recordedAt,
      }]
    }
  }

  return raw.map((r: string) => {
    const parsed = JSON.parse(r) as { cpu: number; mem: number; dr?: number; dw?: number; nr?: number; nt?: number; ts: number }
    return {
      cpuPercent: parsed.cpu,
      memoryUsedMb: parsed.mem,
      diskReadMb: parsed.dr ?? 0,
      diskWriteMb: parsed.dw ?? 0,
      netRxMb: parsed.nr ?? 0,
      netTxMb: parsed.nt ?? 0,
      recordedAt: new Date(parsed.ts).toISOString(),
    }
  })
}

// Streaming / Terminal

/**
 * Gets the container and server for streaming operations (logs, terminal).
 * Throws if the container does not exist, has no assigned server, or the server is offline.
 */
export async function getContainerForStreaming(orgId: string, containerId: string) {
  const [container] = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.id, containerId),
        eq(containers.orgId, orgId),
        isNull(containers.deletedAt),
      ),
    )
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')
  if (!container.serverId) throw new ForbiddenError('The container does not have a server assigned')

  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, container.serverId))
    .limit(1)

  if (!server) throw new NotFoundError('Server not found')
  if (server.status !== 'online' && server.agentMode !== 'self_hosted') {
    throw new ForbiddenError('The server is not online')
  }

  return { container, server }
}

// Container controls (start / stop / restart / inspect)

async function getRunningContainerAndServer(orgId: string, containerId: string) {
  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')
  if (!container.serverId || !container.dockerId) throw new ForbiddenError('The container is not deployed')

  const [server] = await db.select().from(servers).where(eq(servers.id, container.serverId)).limit(1)
  if (!server) throw new NotFoundError('Server not found')
  if (server.status !== 'online' && server.agentMode !== 'self_hosted') {
    throw new ForbiddenError('The server is not online')
  }

  return { container, server }
}

export async function startContainer(orgId: string, containerId: string) {
  const { container, server } = await getRunningContainerAndServer(orgId, containerId)
  await getContainerAgentClient(server).startContainer(server, container.dockerId!)
  await db.update(containers).set({ status: 'running', updatedAt: new Date() }).where(eq(containers.id, containerId))
}

export async function stopContainer(orgId: string, containerId: string) {
  const { container, server } = await getRunningContainerAndServer(orgId, containerId)
  await getContainerAgentClient(server).pauseContainer(server, container.dockerId!)
  await db.update(containers).set({ status: 'stopped', updatedAt: new Date() }).where(eq(containers.id, containerId))
}

export async function restartContainer(orgId: string, containerId: string) {
  const { container, server } = await getRunningContainerAndServer(orgId, containerId)
  await getContainerAgentClient(server).restartContainer(server, container.dockerId!)
  await db.update(containers).set({ status: 'running', updatedAt: new Date() }).where(eq(containers.id, containerId))
}

export async function inspectContainer(orgId: string, containerId: string) {
  const { container, server } = await getRunningContainerAndServer(orgId, containerId)
  return getContainerAgentClient(server).inspectContainer(server, container.dockerId!)
}

// Deploy Token (CI/CD)

/** Generates a new deploy token for the container. Returns the raw token only once. */
export async function regenerateDeployToken(orgId: string, containerId: string) {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  const token = generateDeployToken()
  const hash = hashDeployToken(token)

  await db
    .update(containers)
    .set({ deployTokenHash: hash, updatedAt: new Date() })
    .where(eq(containers.id, containerId))

  return { token }
}

/** Revokes the container deploy token. */
export async function revokeDeployToken(orgId: string, containerId: string) {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Container not found')

  await db
    .update(containers)
    .set({ deployTokenHash: null, updatedAt: new Date() })
    .where(eq(containers.id, containerId))
}

/** Finds a container by deploy token and deploys it from an image or a Git source. */
export async function deployByToken(token: string, opts: { image?: string; git?: GitBuildSource; releaseId?: string }) {
  const hash = hashDeployToken(token)

  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.deployTokenHash, hash), isNull(containers.deletedAt)))
    .limit(1)

  if (!container) throw new NotFoundError('Invalid or revoked token')
  if (container.status === 'deploying') throw new ValidationError('The container is already being deployed')
  if (container.status === 'waiting' && !opts.image && !opts.git) {
    throw new ValidationError('The first deploy requires "image" or "git". Make sure your GitHub Action sends the source.')
  }

  // Update image if a new one is provided.
  if (opts.image && opts.image !== container.image) {
    await db
      .update(containers)
      .set({ image: opts.image, updatedAt: new Date() })
      .where(eq(containers.id, container.id))
    container.image = opts.image
  }

  return deployContainer(container.orgId, container.id, 'ci-cd', {
    git: opts.git,
    releaseId: opts.releaseId,
  })
}

// Plan limit check
