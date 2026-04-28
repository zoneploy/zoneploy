import type { FastifyInstance } from 'fastify'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { servers, containers, stacks } from '../../db/schema.js'
import { decrypt } from '../../lib/crypto.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { config } from '../../config.js'
import { workerClient } from '../../lib/worker-client.js'
import { maybeCreateServerDiskWarning } from './server-disk-alerts.js'

interface HeartbeatBody {
  server: {
    cpuPercent: number
    memoryUsedMb: number
    memoryTotalMb: number
    storageUsedMb: number
    storageTotalMb: number
    cpuCores: number
  }
  containers: Array<{
    dockerId: string
    name: string
    status: string
    cpuPercent: number
    memoryUsedMb: number
    diskReadMb?: number
    diskWriteMb?: number
    netRxMb?: number
    netTxMb?: number
    composeProject?: string
    composeService?: string
  }>
  agentVersion?: string
}

const METRICS_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000
const METRICS_HISTORY_RETENTION_SECONDS = 24 * 60 * 60
const METRICS_HISTORY_MAX_POINTS = 1440

async function pruneMetricsHistory(key: string, nowMs: number) {
  await redis.zremrangebyscore(key, '-inf', nowMs - METRICS_HISTORY_RETENTION_MS)
  await redis.zremrangebyrank(key, 0, -(METRICS_HISTORY_MAX_POINTS + 1))
  await redis.expire(key, METRICS_HISTORY_RETENTION_SECONDS)
}

/**
 * Internal Platform routes, only called by Worker Agents.
 * Authenticated with agent tokens, not user JWTs.
 */
export async function internalRoutes(app: FastifyInstance) {
  app.post('/servers/:serverId/heartbeat', async (request, reply) => {
    const { serverId } = request.params as { serverId: string }
    const authHeader = request.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Token is required' })
    }

    const receivedToken = authHeader.slice(7)

    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), isNull(servers.deletedAt)))
      .limit(1)

    if (!server) return reply.status(404).send({ error: 'Server not found' })

    const storedToken = decrypt({
      encrypted: server.agentTokenEncrypted,
      iv: server.agentTokenIv,
      authTag: server.agentTokenAuthTag,
    })

    if (receivedToken !== storedToken) {
      return reply.status(401).send({ error: 'Invalid token' })
    }

    const body = request.body as HeartbeatBody
    const now = new Date()

    await db
      .update(servers)
      .set({
        status: 'online',
        lastHeartbeatAt: now,
        totalCpuCores: body.server.cpuCores,
        totalMemoryMb: body.server.memoryTotalMb,
        totalStorageMb: body.server.storageTotalMb,
        agentVersion: body.agentVersion ?? null,
        updatedAt: now,
      })
      .where(eq(servers.id, serverId))

    void maybeCreateServerDiskWarning({
      orgId: server.orgId,
      serverId,
      serverName: server.name,
      storageUsedMb: body.server.storageUsedMb,
      storageTotalMb: body.server.storageTotalMb,
    }).catch((error) => {
      console.error('[internal] Failed to process server disk warning:', error)
    })

    const serverLockKey = REDIS_KEYS.metricsHistoryLock(`server:${serverId}`)
    const canWriteServer = await redis.set(serverLockKey, '1', 'NX', 'EX', 60)
    if (canWriteServer) {
      const entry = JSON.stringify({ cpu: body.server.cpuPercent, mem: body.server.memoryUsedMb, ts: now.getTime() })
      const histKey = REDIS_KEYS.metricsHistoryServer(serverId)
      await redis.zadd(histKey, now.getTime(), entry)
      await pruneMetricsHistory(histKey, now.getTime())
    }

    const containerUpdates: Array<{ containerId: string; cpuPercent: number; memoryUsedMb: number; status: string }> = []
    const stackUpdates: Array<{ stackId: string; serviceName: string; cpuPercent: number; memoryUsedMb: number; status: string }> = []

    if (body.containers.length > 0) {
      const [dbContainers, dbStacks] = await Promise.all([
        db
          .select({ id: containers.id, dockerId: containers.dockerId })
          .from(containers)
          .where(and(eq(containers.serverId, serverId), isNull(containers.deletedAt))),
        db
          .select({ id: stacks.id, projectName: stacks.projectName })
          .from(stacks)
          .where(and(eq(stacks.serverId, serverId), isNull(stacks.deletedAt))),
      ])

      const containerMap = new Map<string, typeof dbContainers[number]>()
      for (const container of dbContainers) {
        containerMap.set(container.id, container)
        containerMap.set(`zoneploy-${container.id}`, container)
        if (!container.dockerId) continue
        containerMap.set(container.dockerId, container)
        containerMap.set(container.dockerId.slice(0, 12), container)
      }
      const stackMap = new Map(dbStacks.map(s => [s.projectName, s]))

      for (const agentContainer of body.containers) {
        const dbContainer = containerMap.get(agentContainer.dockerId)
          ?? containerMap.get(agentContainer.dockerId.slice(0, 12))
          ?? containerMap.get(agentContainer.name.replace(/^zoneploy-/, ''))
        if (dbContainer) {
          await redis.setex(
            REDIS_KEYS.containerMetrics(dbContainer.id),
            60,
            JSON.stringify({
              cpuPercent: agentContainer.cpuPercent,
              memoryUsedMb: agentContainer.memoryUsedMb,
              status: agentContainer.status,
              recordedAt: now.toISOString(),
            }),
          )

          const containerLockKey = REDIS_KEYS.metricsHistoryLock(`container:${dbContainer.id}`)
          const canWriteContainer = await redis.set(containerLockKey, '1', 'NX', 'EX', 60)
          if (canWriteContainer) {
            const entry = JSON.stringify({
              cpu: agentContainer.cpuPercent,
              mem: agentContainer.memoryUsedMb,
              dr: agentContainer.diskReadMb ?? 0,
              dw: agentContainer.diskWriteMb ?? 0,
              nr: agentContainer.netRxMb ?? 0,
              nt: agentContainer.netTxMb ?? 0,
              ts: now.getTime(),
            })
            const histKey = REDIS_KEYS.metricsHistoryContainer(dbContainer.id)
            await redis.zadd(histKey, now.getTime(), entry)
            await pruneMetricsHistory(histKey, now.getTime())
          }

          containerUpdates.push({
            containerId: dbContainer.id,
            cpuPercent: agentContainer.cpuPercent,
            memoryUsedMb: agentContainer.memoryUsedMb,
            status: agentContainer.status,
          })
          continue
        }

        if (!agentContainer.composeProject || !agentContainer.composeService) continue

        const dbStack = stackMap.get(agentContainer.composeProject)
        if (!dbStack) continue

        await redis.setex(
          REDIS_KEYS.stackServiceMetrics(dbStack.id, agentContainer.composeService),
          60,
          JSON.stringify({
            cpuPercent: agentContainer.cpuPercent,
            memoryUsedMb: agentContainer.memoryUsedMb,
            diskReadMb: agentContainer.diskReadMb ?? 0,
            diskWriteMb: agentContainer.diskWriteMb ?? 0,
            netRxMb: agentContainer.netRxMb ?? 0,
            netTxMb: agentContainer.netTxMb ?? 0,
            status: agentContainer.status,
            recordedAt: now.toISOString(),
          }),
        )

        const stackLockKey = REDIS_KEYS.metricsHistoryLock(`stack:${dbStack.id}:service:${agentContainer.composeService}`)
        const canWriteStackService = await redis.set(stackLockKey, '1', 'NX', 'EX', 60)
        if (canWriteStackService) {
          const entry = JSON.stringify({
            cpu: agentContainer.cpuPercent,
            mem: agentContainer.memoryUsedMb,
            dr: agentContainer.diskReadMb ?? 0,
            dw: agentContainer.diskWriteMb ?? 0,
            nr: agentContainer.netRxMb ?? 0,
            nt: agentContainer.netTxMb ?? 0,
            ts: now.getTime(),
          })
          const histKey = REDIS_KEYS.metricsHistoryStackService(dbStack.id, agentContainer.composeService)
          await redis.zadd(histKey, now.getTime(), entry)
          await pruneMetricsHistory(histKey, now.getTime())
        }

        stackUpdates.push({
          stackId: dbStack.id,
          serviceName: agentContainer.composeService,
          cpuPercent: agentContainer.cpuPercent,
          memoryUsedMb: agentContainer.memoryUsedMb,
          status: agentContainer.status,
        })
      }
    }

    await redis.publish(
      REDIS_KEYS.orgMetricsChannel(server.orgId),
      JSON.stringify({
        serverId,
        server: body.server,
        containers: containerUpdates,
        stackServices: stackUpdates,
        ts: now.toISOString(),
      }),
    )

    return reply.status(204).send()
  })

  app.post('/servers/push-certs', async (request, reply) => {
    if (!config.INTERNAL_API_TOKEN) {
      return reply.status(503).send({ error: 'INTERNAL_API_TOKEN is not configured' })
    }

    const token = request.headers['x-internal-token']
    if (token !== config.INTERNAL_API_TOKEN) {
      return reply.status(401).send({ error: 'Invalid token' })
    }

    const { cert, key } = request.body as { cert?: string; key?: string }
    if (!cert || !key) {
      return reply.status(400).send({ error: 'cert and key are required' })
    }

    const onlineServers = await db
      .select()
        .from(servers)
        .where(and(eq(servers.status, 'online'), isNull(servers.deletedAt)))

    let pushed = 0
    await Promise.all(
      onlineServers.map(async (server) => {
        try {
          await workerClient.pushCert(server, cert, key)
          pushed++
        } catch (err) {
          console.error(`[certs] Error pushing cert a server ${server.id}:`, (err as Error).message)
        }
      }),
    )

    return reply.send({ pushed, total: onlineServers.length })
  })
}
