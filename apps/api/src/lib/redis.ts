import Redis from 'ioredis'
import { config } from '../config.js'

// @ts-ignore - ioredis v5 has complicated ESM types.
export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
})

redis.on('error', (err: Error) => {
  console.error('Redis error:', err)
})

// Key prefixes to avoid collisions.
export const REDIS_KEYS = {
  // Gateway: hostname to route target.
  route: (hostname: string) => `rs:routes:${hostname}`,
  routesHash: 'rs:routes',

  // Current metrics cache by container.
  containerMetrics: (containerId: string) => `rs:metrics:container:${containerId}`,
  stackServiceMetrics: (stackId: string, serviceName: string) => `rs:metrics:stack:${stackId}:service:${serviceName}`,

  // Refresh tokens for invalidation.
  refreshToken: (tokenHash: string) => `rs:rt:${tokenHash}`,

  // WebAuthn: challenges temporales (TTL 5 min)
  webauthnChallenge: (userId: string) => `rs:webauthn:challenge:${userId}`,

  // Provisioning logs by server (1h TTL, used for SSE).
  provisionLogs: (serverId: string) => `rs:provision:logs:${serverId}`,

  // Logs de deploy (TTL 7d). List de JSON: { message, level, ts, done? }
  // The control plane publishes here during deploys; the frontend reads via SSE.
  deployLogs: (deploymentId: string) => `rs:deploy:logs:${deploymentId}`,

  // Pub/sub channel for real-time deploy log entries.
  deployLogsChannel: (deploymentId: string) => `deploy:${deploymentId}:new`,

  // Real-time metrics pub/sub channel by organization.
  // Published on each agent heartbeat; the frontend subscribes via SSE.
  orgMetricsChannel: (orgId: string) => `ws:${orgId}:metrics`,

  // Metrics history: sorted sets with score = Unix timestamp in ms.
  // Cap: 1,440 entries (1 point/min x 24h). DB is not used.
  metricsHistoryServer: (serverId: string) => `rs:metrics:history:server:${serverId}`,
  metricsHistoryContainer: (containerId: string) => `rs:metrics:history:container:${containerId}`,
  metricsHistoryStackService: (stackId: string, serviceName: string) => `rs:metrics:history:stack:${stackId}:service:${serviceName}`,

  // History rate mutex: avoids writing more than one point per minute per entity.
  metricsHistoryLock: (id: string) => `rs:metrics:history:lock:${id}`,

  // Server alert throttle windows.
  serverDiskWarning: (serverId: string) => `rs:alerts:server-disk:${serverId}`,

  // Scheduled stack backup policy mutex.
  stackBackupPolicyLock: (policyId: string) => `rs:backup:policy-lock:${policyId}`,
} as const
