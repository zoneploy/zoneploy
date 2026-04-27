import { eq, and, isNull, ne, desc, count, notInArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  stacks,
  stackBackupPolicies,
  stackSecrets,
  stackDeployments,
  servers,
  environments,
  projects,
  zoneployPublicEndpoints,
  customPublicEndpoints,
  addOnBindings,
} from '../../db/schema.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { NotFoundError, ValidationError, AppError, ForbiddenError } from '../../lib/errors.js'
import { generateSlug } from '../../lib/slug.js'
import { workerClient } from '../../lib/worker-client.js'
import type { AgentStackBackupStorageTarget, GitBuildSource } from '../../lib/worker-client.js'
import { getStackAgentClient } from '../../lib/server-agent-client.js'
import { encrypt, decrypt } from '../../lib/crypto.js'
import { generateDeployToken, hashDeployToken } from '../../lib/deploy-token.js'
import type { CreateStackInput, UpdateStackInput } from '@zoneploy/types'
import { config } from '../../config.js'
import {
  assertCustomDomainLimit,
  assertDeploymentLimit,
  assertSubdomainLimit,
} from '../../lib/plan-limits.js'
import { getEnvSecretsDecrypted } from '../environments/environments.service.js'
import { findVerifiedCustomDomainConflict } from '../../lib/custom-domain-claims.js'
import { removeCustomDomainTls } from '../../lib/custom-domain-tls.js'
import { verifyHostnamePointsToTarget } from '../../lib/verify-dns-target.js'
import { listStackDomainsWithDeps } from './stack-domain-listing.js'
import { buildStackRouteMappingsWithDeps, syncStackRuntimeRoutesWithDeps } from './stack-runtime-routes.js'
import { deleteStackWithDeps } from './stack-cleanup.js'
import {
  addStackCustomEndpointWithDeps,
  addStackZoneployEndpointWithDeps,
  removeStackCustomEndpointWithDeps,
  removeStackZoneployEndpointWithDeps,
  updateStackZoneployEndpointWithDeps,
  updateStackCustomEndpointWithDeps,
  verifyStackCustomEndpointWithDeps,
} from './stack-domain-operations.js'
import {
  CUSTOM_DOMAINS_EDGE_SLUG,
  resolveCustomDomainRoutingForOwner,
} from '../../lib/custom-domain-routing.js'
import {
  assertValidZoneploySlug,
  buildZoneployHostnameLabel,
  generateZoneploySlug,
  getZoneployFullDomain,
  listCustomEndpoints,
  listZoneployEndpoints,
  promoteNextPrimaryPublicEndpoint,
} from '../../lib/public-endpoints.js'
import {
  deriveStackStatusFromServices,
  listDeclaredComposeServices,
  listRuntimeServicePortsFromInspect,
  mapRuntimeStatus,
  resolveComposeServiceByPort,
} from './stack-service-plan.js'

function formatStack(s: typeof stacks.$inferSelect) {
  return {
    id: s.id,
    orgId: s.orgId,
    environmentId: s.environmentId,
    serverId: s.serverId,
    name: s.name,
    slug: s.slug,
    projectName: s.projectName,
    composeContent: s.composeContent,
    status: s.status,
    errorReason: s.errorReason,
    hasDeployToken: !!s.deployTokenHash,
    deletedAt: s.deletedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

async function enrichStack(stack: typeof stacks.$inferSelect) {
  const envRow = stack.environmentId
    ? await db
        .select({ environmentName: environments.name, projectDisplayName: projects.name })
        .from(environments)
        .innerJoin(projects, eq(environments.projectId, projects.id))
        .where(eq(environments.id, stack.environmentId))
        .limit(1)
        .then(r => r[0] ?? null)
    : null

  return {
    ...formatStack(stack),
    environmentName: envRow?.environmentName ?? null,
    projectDisplayName: envRow?.projectDisplayName ?? null,
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

async function listRuntimeStackServicePorts(
  server: typeof servers.$inferSelect,
  stackId: string,
  projectName: string,
): Promise<Array<{ serviceName: string; ports: number[] }>> {
  const agentClient = getStackAgentClient(server)
  const services = await agentClient.listStackServices(server, stackId, projectName)
  const results = await Promise.all(
    services.map(async (service) => {
      try {
        const inspect = await agentClient.inspectStackService(server, stackId, projectName, service.serviceName)
        return {
          serviceName: service.serviceName,
          ports: listRuntimeServicePortsFromInspect(inspect),
        }
      } catch {
        return {
          serviceName: service.serviceName,
          ports: [],
        }
      }
    }),
  )

  return results
}

async function resolveStackServiceByPort(
  composeContent: string | null,
  port: number,
  runtimePortsPromise?: Promise<Array<{ serviceName: string; ports: number[] }>>,
): Promise<string | null> {
  const composeResolved = resolveComposeServiceByPort(composeContent, port)
  if (composeResolved) return composeResolved

  if (!runtimePortsPromise) return null

  const runtimeServices = await runtimePortsPromise
  const runtimeResolved = runtimeServices.find(service => service.ports.includes(port))
  return runtimeResolved?.serviceName ?? null
}

async function resolveStackPublicEndpoint(
  stack: Pick<typeof stacks.$inferSelect, 'id' | 'projectName' | 'composeContent'>,
  port: number,
  server?: typeof servers.$inferSelect | null,
  composeContentOverride?: string | null,
) {
  const runtimePortsPromise = server
    ? listRuntimeStackServicePorts(server, stack.id, stack.projectName).catch(() => [])
    : undefined
  const composeContent = composeContentOverride ?? stack.composeContent
  const resolvedServiceName = await resolveStackServiceByPort(composeContent, port, runtimePortsPromise)

  return {
    resolvedServiceName,
    portResolved: !!resolvedServiceName,
  }
}

function formatStackZoneployEndpoint(endpoint: typeof zoneployPublicEndpoints.$inferSelect) {
  return {
    id: endpoint.id,
    stackId: endpoint.ownerId,
    port: endpoint.port,
    slug: endpoint.hostnameLabel,
    hostnameLabel: endpoint.hostnameLabel,
    fullDomain: getZoneployFullDomain('stack', endpoint.hostnameLabel),
    isPrimary: endpoint.isPrimary,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  }
}

function formatStackCustomEndpoint(
  endpoint: typeof customPublicEndpoints.$inferSelect,
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  return {
    id: endpoint.id,
    stackId: endpoint.ownerId,
    port: endpoint.port,
    hostname: endpoint.hostname,
    verified: endpoint.verified,
    isPrimary: endpoint.isPrimary,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
    routingMode: routing.mode,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  }
}

function formatStackCustomRouting(
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  return {
    mode: routing.mode,
    enabled: routing.mode === 'server-addon' && !!routing.target && !!routing.recordType,
    addonSlug: CUSTOM_DOMAINS_EDGE_SLUG,
    serverId: routing.serverId,
    installationId: routing.installationId,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
  }
}

function assertStackCustomDomainsEnabled(
  routing: Awaited<ReturnType<typeof resolveCustomDomainRoutingForOwner>>,
) {
  if (routing.mode !== 'server-addon' || !routing.target || !routing.recordType) {
    throw new AppError(403, 'CUSTOM_DOMAINS_ADDON_REQUIRED', 'Install Custom Domains Edge on this server to use custom domains')
  }
}

function formatStackDeployment(d: typeof stackDeployments.$inferSelect) {
  return {
    id: d.id,
    stackId: d.stackId,
    orgId: d.orgId,
    serverId: d.serverId,
    composeSnapshot: d.composeSnapshot,
    secretKeysSnapshot: d.secretKeysSnapshot,
    status: d.status,
    triggeredBy: d.triggeredBy,
    errorMessage: d.errorMessage,
    startedAt: d.startedAt.toISOString(),
    finishedAt: d.finishedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }
}

function validateStackCustomDomain(domain: string) {
  const re = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
  if (!re.test(domain)) throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', 'Invalid domain format')
  if (domain.endsWith(`.${config.ROUTING_DOMAIN}`)) {
    throw new AppError(400, 'INVALID_CUSTOM_DOMAIN', `Cannot use a ${config.ROUTING_DOMAIN} subdomain as a custom domain`)
  }
}

async function getStackRow(orgId: string, stackId: string) {
  const [stack] = await db
    .select()
    .from(stacks)
    .where(and(eq(stacks.id, stackId), eq(stacks.orgId, orgId), isNull(stacks.deletedAt)))
    .limit(1)

  if (!stack) throw new NotFoundError('Stack no encontrado')
  return stack
}

async function getStackAndServer(orgId: string, stackId: string) {
  const stack = await getStackRow(orgId, stackId)
  if (!stack.serverId) throw new ForbiddenError('El stack no tiene Servidor asignado')

  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, stack.serverId))
    .limit(1)

  if (!server) throw new NotFoundError('Servidor no encontrado')
  if (server.status !== 'online') throw new ForbiddenError('Server is not online')

  return { stack, server }
}

type StackBackupPolicyRow = typeof stackBackupPolicies.$inferSelect

export interface UpdateStackBackupPolicyInput {
  enabled?: boolean
  intervalHours?: number
  retentionCount?: number
  storageProvider?: 'local-vps' | 's3-compatible'
  storageConfig?: {
    endpoint?: string
    bucket?: string
    region?: string
    prefix?: string
    forcePathStyle?: boolean
    accessKeyId?: string
    secretAccessKey?: string
  }
}

export function calculateNextStackBackupRun(from: Date, intervalHours: number) {
  return new Date(from.getTime() + Math.max(1, intervalHours) * 60 * 60 * 1000)
}

function formatStackBackupPolicy(policy: StackBackupPolicyRow | null, stackId: string, orgId: string) {
  const storageConfig = policy?.storageConfig ?? {}
  return {
    id: policy?.id ?? null,
    stackId,
    orgId,
    enabled: policy?.enabled ?? false,
    intervalHours: policy?.intervalHours ?? 24,
    retentionCount: policy?.retentionCount ?? 5,
    storageProvider: policy?.storageProvider ?? 'local-vps',
    storageConfig: {
      endpoint: storageConfig.endpoint ?? '',
      bucket: storageConfig.bucket ?? '',
      region: storageConfig.region ?? 'us-east-1',
      prefix: storageConfig.prefix ?? 'zoneploy',
      forcePathStyle: storageConfig.forcePathStyle ?? true,
      accessKeyIdConfigured: !!storageConfig.accessKeyId,
      secretAccessKeyConfigured: !!storageConfig.secretAccessKey,
    },
    lastRunAt: policy?.lastRunAt?.toISOString() ?? null,
    nextRunAt: policy?.nextRunAt?.toISOString() ?? null,
    lastStatus: policy?.lastStatus ?? 'never',
    lastError: policy?.lastError ?? null,
    createdAt: policy?.createdAt?.toISOString() ?? null,
    updatedAt: policy?.updatedAt?.toISOString() ?? null,
  }
}

function normalizeBackupPolicyInput(input: UpdateStackBackupPolicyInput, existing: StackBackupPolicyRow | null) {
  const intervalHours = Math.min(Math.max(Math.floor(input.intervalHours ?? existing?.intervalHours ?? 24), 1), 720)
  const retentionCount = Math.min(Math.max(Math.floor(input.retentionCount ?? existing?.retentionCount ?? 5), 1), 30)
  const storageProvider = input.storageProvider ?? existing?.storageProvider ?? 'local-vps'
  const previousConfig = existing?.storageConfig ?? {}
  const incomingConfig = input.storageConfig ?? {}
  const storageConfig = storageProvider === 's3-compatible'
    ? {
        endpoint: incomingConfig.endpoint?.trim() || previousConfig.endpoint,
        bucket: incomingConfig.bucket?.trim() || previousConfig.bucket,
        region: incomingConfig.region?.trim() || previousConfig.region || 'us-east-1',
        prefix: incomingConfig.prefix?.trim() || previousConfig.prefix || 'zoneploy',
        forcePathStyle: incomingConfig.forcePathStyle ?? previousConfig.forcePathStyle ?? true,
        accessKeyId: incomingConfig.accessKeyId ? encrypt(incomingConfig.accessKeyId) : previousConfig.accessKeyId,
        secretAccessKey: incomingConfig.secretAccessKey ? encrypt(incomingConfig.secretAccessKey) : previousConfig.secretAccessKey,
      }
    : {}

  if (storageProvider === 's3-compatible') {
    if (!storageConfig.endpoint || !storageConfig.bucket || !storageConfig.accessKeyId || !storageConfig.secretAccessKey) {
      throw new ValidationError('S3-compatible backup storage requires endpoint, bucket, access key and secret key')
    }
  }

  return { intervalHours, retentionCount, storageProvider, storageConfig }
}

function buildStackBackupStorageTarget(policy: StackBackupPolicyRow | null): AgentStackBackupStorageTarget | undefined {
  if (!policy || policy.storageProvider === 'local-vps') return { provider: 'local-vps' }
  const config = policy.storageConfig
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new ValidationError('External backup storage is incomplete')
  }

  return {
    provider: 's3-compatible',
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: config.region ?? 'us-east-1',
    prefix: config.prefix ?? 'zoneploy',
    forcePathStyle: config.forcePathStyle ?? true,
    accessKeyId: decrypt(config.accessKeyId),
    secretAccessKey: decrypt(config.secretAccessKey),
  }
}

async function getStackBackupPolicyRow(stackId: string) {
  const [policy] = await db
    .select()
    .from(stackBackupPolicies)
    .where(eq(stackBackupPolicies.stackId, stackId))
    .limit(1)

  return policy ?? null
}

async function listStackZoneployRows(stackId: string) {
  return listZoneployEndpoints('stack', stackId)
}

async function listStackCustomRows(stackId: string) {
  return listCustomEndpoints('stack', stackId)
}

async function getStackEndpointCounts(stackId: string) {
  const [zoneployRows, customRows] = await Promise.all([
    listStackZoneployRows(stackId),
    listStackCustomRows(stackId),
  ])

  return {
    zoneployRows,
    customRows,
    total: zoneployRows.length + customRows.length,
  }
}

async function syncRedisForStackDomains(stackId: string) {
  const [stack] = await db
    .select({ id: stacks.id, serverId: stacks.serverId, status: stacks.status, deletedAt: stacks.deletedAt, projectName: stacks.projectName, composeContent: stacks.composeContent })
    .from(stacks)
    .where(eq(stacks.id, stackId))
    .limit(1)

  if (!stack?.serverId || stack.status !== 'running' || stack.deletedAt) return

  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, stack.serverId))
    .limit(1)

  if (!server) return

  const routePort = server.agentMode === 'self_hosted' ? 80 : config.CERTS_PATH ? 443 : 8899
  const routeTarget = JSON.stringify({ ip: server.ipAddress, port: routePort })
  const customRouting = await resolveCustomDomainRoutingForOwner('stack', stackId)
  const [zoneployRows, customRows] = await Promise.all([
    listStackZoneployRows(stackId),
    listStackCustomRows(stackId),
  ])

  for (const endpoint of zoneployRows) {
    const { portResolved } = await resolveStackPublicEndpoint(stack, endpoint.port, server)
    if (!portResolved) continue
    await redis.hset(REDIS_KEYS.routesHash, getZoneployFullDomain('stack', endpoint.hostnameLabel), routeTarget)
  }

  for (const endpoint of customRows) {
    if (customRouting.mode !== 'platform') continue
    const { portResolved } = await resolveStackPublicEndpoint(stack, endpoint.port, server)
    if (!portResolved || !endpoint.verified) continue
    await redis.hset(REDIS_KEYS.routesHash, endpoint.hostname, routeTarget)
  }
}

async function clearRedisForStackDomains(stackId: string) {
  const [zoneployRows, customRows] = await Promise.all([
    listStackZoneployRows(stackId),
    listStackCustomRows(stackId),
  ])

  for (const endpoint of zoneployRows) {
    await redis.hdel(REDIS_KEYS.routesHash, getZoneployFullDomain('stack', endpoint.hostnameLabel))
  }

  for (const endpoint of customRows) {
    await redis.hdel(REDIS_KEYS.routesHash, endpoint.hostname)
  }
}

async function buildStackRouteMappings(
  stack: Pick<typeof stacks.$inferSelect, 'id' | 'projectName' | 'composeContent'>,
  server?: typeof servers.$inferSelect | null,
  composeContentOverride?: string | null,
) {
  return buildStackRouteMappingsWithDeps(
    stack,
    {
      listZoneployRows: listStackZoneployRows,
      listCustomRows: listStackCustomRows,
      resolvePublicEndpoint: resolveStackPublicEndpoint,
    },
    server,
    composeContentOverride,
  )
}

async function syncStackRuntimeRoutes(stackId: string) {
  return syncStackRuntimeRoutesWithDeps(stackId, {
    getStack: async (id) => {
      const [stack] = await db
        .select()
        .from(stacks)
        .where(eq(stacks.id, id))
        .limit(1)
      return stack
    },
    getServer: async (serverId) => {
      const [server] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1)
      return server
    },
    buildRouteMappings: buildStackRouteMappings,
    syncRoutes: (server, payload) => getStackAgentClient(server as typeof servers.$inferSelect).syncStackRoutes(server as typeof servers.$inferSelect, payload),
    syncRedis: syncRedisForStackDomains,
    platformDomain: config.ROUTING_DOMAIN,
  })
}

async function pruneStackDeploymentHistory(stackId: string, keep = 20) {
  const rows = await db
    .select({ id: stackDeployments.id })
    .from(stackDeployments)
    .where(eq(stackDeployments.stackId, stackId))
    .orderBy(desc(stackDeployments.createdAt))

  if (rows.length <= keep) return

  await db
    .delete(stackDeployments)
    .where(and(eq(stackDeployments.stackId, stackId), notInArray(stackDeployments.id, rows.slice(0, keep).map(row => row.id))))
}

export async function getStackForStreaming(orgId: string, stackId: string) {
  return getStackAndServer(orgId, stackId)
}

export async function listStacks(orgId: string) {
  const result = await db
    .select()
    .from(stacks)
    .where(and(eq(stacks.orgId, orgId), isNull(stacks.deletedAt)))
    .orderBy(stacks.createdAt)

  return Promise.all(result.map(enrichStack))
}

export async function getStack(orgId: string, stackId: string) {
  return enrichStack(await getStackRow(orgId, stackId))
}

export async function listStackDeployments(orgId: string, stackId: string, page = 1, limit = 20) {
  await getStackRow(orgId, stackId)

  const offset = (page - 1) * limit

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(stackDeployments)
      .where(eq(stackDeployments.stackId, stackId))
      .orderBy(desc(stackDeployments.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(stackDeployments)
      .where(eq(stackDeployments.stackId, stackId)),
  ])

  return {
    data: rows.map(formatStackDeployment),
    meta: {
      total: total?.count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  }
}

export async function createStack(orgId: string, input: CreateStackInput) {
  await assertDeploymentLimit(orgId)

  const slug = generateSlug(input.name)
  const [existing] = await db
    .select({ id: stacks.id })
    .from(stacks)
    .where(and(eq(stacks.orgId, orgId), eq(stacks.slug, slug), isNull(stacks.deletedAt)))
    .limit(1)

  if (existing) throw new ValidationError('A stack with that name already exists in this organization')

  const deployToken = generateDeployToken()
  const deployTokenHash = hashDeployToken(deployToken)
  const serverId = input.serverId ?? await getDefaultServerId(orgId)

  const [stack] = await db
    .insert(stacks)
    .values({
      orgId,
      environmentId: input.environmentId,
      name: input.name,
      slug,
      projectName: '',
      serverId,
      composeContent: input.composeContent ?? null,
      deployTokenHash,
    })
    .returning()

  if (!stack) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear el Stack')

  const projectName = `rs-${stack.id.slice(0, 8)}`
  const [updated] = await db
    .update(stacks)
    .set({ projectName })
    .where(eq(stacks.id, stack.id))
    .returning()

  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'Error al actualizar el Stack')

  return { ...formatStack(updated), deployToken }
}

export async function updateStack(orgId: string, stackId: string, input: UpdateStackInput) {
  await getStackRow(orgId, stackId)

  const [updated] = await db
    .update(stacks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(stacks.id, stackId))
    .returning()

  return formatStack(updated!)
}

export async function deleteStack(orgId: string, stackId: string) {
  const stack = await getStackRow(orgId, stackId)
  await deleteStackWithDeps(stack, {
    getServer: async (serverId) => {
      const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1)
      return server ?? null
    },
    purgeRuntime: (server, id, projectName) => getStackAgentClient(server as typeof servers.$inferSelect).purgeStackRuntime(server as typeof servers.$inferSelect, id, projectName),
    clearRedisRoutes: clearRedisForStackDomains,
    softDeleteAddOnBindings: (id) => db
      .update(addOnBindings)
      .set({ status: 'disabled', deletedAt: new Date(), deleteReason: 'stack_deleted', updatedAt: new Date() })
      .where(and(eq(addOnBindings.ownerType, 'stack'), eq(addOnBindings.ownerId, id), isNull(addOnBindings.deletedAt))),
    softDeleteZoneployEndpoints: (id) => db
      .update(zoneployPublicEndpoints)
      .set({ isPrimary: false, deletedAt: new Date(), deleteReason: 'stack_deleted', updatedAt: new Date() })
      .where(and(eq(zoneployPublicEndpoints.ownerType, 'stack'), eq(zoneployPublicEndpoints.ownerId, id), isNull(zoneployPublicEndpoints.deletedAt))),
    softDeleteCustomEndpoints: (id) => db
      .update(customPublicEndpoints)
      .set({ isPrimary: false, verified: false, deletedAt: new Date(), deleteReason: 'stack_deleted', updatedAt: new Date() })
      .where(and(eq(customPublicEndpoints.ownerType, 'stack'), eq(customPublicEndpoints.ownerId, id), isNull(customPublicEndpoints.deletedAt))),
    softDelete: (id) => db
      .update(stacks)
      .set({ deletedAt: new Date(), status: 'stopped', updatedAt: new Date() })
      .where(eq(stacks.id, id)),
  })
}

export async function deployStack(
  orgId: string,
  stackId: string,
  composeContent: string,
  triggeredBy: string,
  registry?: { registryUser: string; registryPassword: string },
  options: { git?: GitBuildSource; releaseId?: string } = {},
) {
  const stack = await getStackRow(orgId, stackId)
  if (stack.status === 'deploying') throw new ValidationError('Stack is already being deployed')
  if (!stack.serverId) throw new ValidationError('El Stack no tiene un Servidor asignado')

  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, stack.serverId), eq(servers.orgId, orgId)))
    .limit(1)

  if (!server) throw new NotFoundError('Server no encontrado')
  if (server.status !== 'online') throw new AppError(409, 'SERVER_UNAVAILABLE', 'Server is not online')
  const registryUser = registry?.registryUser
  const registryPassword = registry?.registryPassword

  const rawSecrets = await db
    .select()
    .from(stackSecrets)
    .where(eq(stackSecrets.stackId, stackId))

  const envVars: Record<string, string> = stack.environmentId
    ? await getEnvSecretsDecrypted(stack.environmentId)
    : {}
  for (const s of rawSecrets) {
    envVars[s.key] = decrypt({ encrypted: s.valueEncrypted, iv: s.iv, authTag: s.authTag })
  }
  const [deployment] = await db
    .insert(stackDeployments)
    .values({
      stackId,
      orgId,
      serverId: server.id,
      composeSnapshot: composeContent,
      secretKeysSnapshot: Array.from(new Set([
        ...Object.keys(envVars),
        ...rawSecrets.map(secret => secret.key),
      ])),
      triggeredBy,
      status: 'pending',
    })
    .returning()

  if (!deployment) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear el deployment del stack')

  pruneStackDeploymentHistory(stackId, 20).catch(() => null)

  const routeMappings = await buildStackRouteMappings(stack, server, composeContent)

  await db
    .update(stacks)
    .set({ status: 'deploying', serverId: server.id, composeContent, updatedAt: new Date() })
    .where(eq(stacks.id, stackId))

  void (async () => {
    try {
      await db
        .update(stackDeployments)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(stackDeployments.id, deployment.id))

      const deployOptions = {
        stackId,
        projectName: stack.projectName,
        composeContent,
        envVars,
        platformDomain: config.ROUTING_DOMAIN,
        domainMappings: routeMappings,
        registryUser,
        registryPassword,
      }

      if (options.git) {
        await getStackAgentClient(server).buildAndDeployStack(server, {
          ...deployOptions,
          git: options.git,
          releaseId: options.releaseId,
        })
      } else {
        await getStackAgentClient(server).deployStack(server, deployOptions)
      }

      await db
        .update(stacks)
        .set({ status: 'running', errorReason: null, updatedAt: new Date() })
        .where(eq(stacks.id, stackId))
      await db
        .update(stackDeployments)
        .set({ status: 'success', finishedAt: new Date() })
        .where(eq(stackDeployments.id, deployment.id))
      await syncRedisForStackDomains(stackId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      await db
        .update(stacks)
        .set({ status: 'error', errorReason: msg, updatedAt: new Date() })
        .where(eq(stacks.id, stackId))
      await db
        .update(stackDeployments)
        .set({ status: 'failed', errorMessage: msg, finishedAt: new Date() })
        .where(eq(stackDeployments.id, deployment.id))
    }
  })()

  return { stackId, deploymentId: deployment.id, status: 'deploying', triggeredBy }
}

export async function deployStackByToken(
  token: string,
  composeContent: string,
  options: { git?: GitBuildSource; releaseId?: string } = {},
) {
  const hash = hashDeployToken(token)

  const [stack] = await db
    .select()
    .from(stacks)
    .where(and(eq(stacks.deployTokenHash, hash), isNull(stacks.deletedAt)))
    .limit(1)

  if (!stack) throw new NotFoundError('Token inválido o revocado')

  return deployStack(stack.orgId, stack.id, composeContent, 'ci-cd', undefined, options)
}

export async function regenerateStackDeployToken(orgId: string, stackId: string) {
  await getStackRow(orgId, stackId)

  const token = generateDeployToken()
  const hash = hashDeployToken(token)

  await db
    .update(stacks)
    .set({ deployTokenHash: hash, updatedAt: new Date() })
    .where(eq(stacks.id, stackId))

  return { token }
}

export async function revokeStackDeployToken(orgId: string, stackId: string) {
  await getStackRow(orgId, stackId)

  await db
    .update(stacks)
    .set({ deployTokenHash: null, updatedAt: new Date() })
    .where(eq(stacks.id, stackId))
}

export async function listStackSecrets(orgId: string, stackId: string) {
  await getStack(orgId, stackId)

  return db
    .select({ id: stackSecrets.id, stackId: stackSecrets.stackId, key: stackSecrets.key, createdAt: stackSecrets.createdAt, updatedAt: stackSecrets.updatedAt })
    .from(stackSecrets)
    .where(eq(stackSecrets.stackId, stackId))
    .orderBy(stackSecrets.key)
}

export async function upsertStackSecret(orgId: string, stackId: string, key: string, value: string) {
  await getStack(orgId, stackId)

  const [existing] = await db
    .select({ id: stackSecrets.id })
    .from(stackSecrets)
    .where(and(eq(stackSecrets.stackId, stackId), eq(stackSecrets.key, key)))
    .limit(1)

  const { encrypted, iv, authTag } = encrypt(value)
  const now = new Date()

  await db
    .insert(stackSecrets)
    .values({ stackId, orgId, key, valueEncrypted: encrypted, iv, authTag })
    .onConflictDoUpdate({
      target: [stackSecrets.stackId, stackSecrets.key],
      set: { valueEncrypted: encrypted, iv, authTag, updatedAt: now },
    })

  return { key, created: !existing }
}

export async function deleteStackSecret(orgId: string, stackId: string, key: string) {
  await getStack(orgId, stackId)

  const deleted = await db
    .delete(stackSecrets)
    .where(and(eq(stackSecrets.stackId, stackId), eq(stackSecrets.key, key)))
    .returning({ id: stackSecrets.id })

  if (!deleted.length) throw new NotFoundError('Secret no encontrado')
}

export async function listStackDomains(orgId: string, stackId: string) {
  const stack = await getStackRow(orgId, stackId)
  return listStackDomainsWithDeps(stackId, stack, {
    syncRuntime: syncStackRuntimeRoutes,
    resolveRouting: (id) => resolveCustomDomainRoutingForOwner('stack', id),
    getServer: async (serverId) => {
      const [server] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1)
      return server ?? null
    },
    listZoneployRows: listStackZoneployRows,
    listCustomRows: listStackCustomRows,
    resolvePublicEndpoint: resolveStackPublicEndpoint,
    formatZoneployEndpoint: formatStackZoneployEndpoint,
    formatCustomEndpoint: formatStackCustomEndpoint,
    formatCustomRouting: formatStackCustomRouting,
  })
}

export async function addStackZoneployEndpoint(
  orgId: string,
  stackId: string,
  input: { port: number },
) {
  await assertSubdomainLimit(orgId)
  await getStackRow(orgId, stackId)
  const counts = await getStackEndpointCounts(stackId)
  return addStackZoneployEndpointWithDeps(stackId, generateZoneploySlug(), counts.total, input.port, {
    buildHostnameLabel: (slug) => buildZoneployHostnameLabel('stack', slug),
    assertUniquePort: async (ownerId, port) => {
      const [portConflict] = await db
        .select({ id: zoneployPublicEndpoints.id })
        .from(zoneployPublicEndpoints)
        .where(and(
          eq(zoneployPublicEndpoints.ownerType, 'stack'),
          eq(zoneployPublicEndpoints.ownerId, ownerId),
          eq(zoneployPublicEndpoints.port, port),
          isNull(zoneployPublicEndpoints.deletedAt),
        ))
        .limit(1)

      if (portConflict) {
        throw new AppError(409, 'ZONEPLOY_PORT_ALREADY_EXISTS', `Port ${port} already has a Zoneploy domain in this stack`)
      }
    },
    assertUniqueHostnameLabel: async (hostnameLabel) => {
      const [hostnameConflict] = await db
        .select({ id: zoneployPublicEndpoints.id })
        .from(zoneployPublicEndpoints)
        .where(and(
          eq(zoneployPublicEndpoints.hostnameLabel, hostnameLabel),
          isNull(zoneployPublicEndpoints.deletedAt),
        ))
        .limit(1)

      if (hostnameConflict) {
        throw new AppError(409, 'ZONEPLOY_HOSTNAME_IN_USE', `Subdomain ${hostnameLabel} is already in use`)
      }
    },
    persistCreate: async (values) => {
      const [created] = await db
        .insert(zoneployPublicEndpoints)
        .values({
          orgId,
          ownerType: 'stack',
          ownerId: stackId,
          port: values.port,
          hostnameLabel: values.hostnameLabel,
          isPrimary: values.isPrimary,
        })
        .returning()
      return created
    },
    syncRuntime: syncStackRuntimeRoutes,
    formatZoneployEndpoint: formatStackZoneployEndpoint,
  })
}

export async function updateStackZoneployEndpoint(
  orgId: string,
  stackId: string,
  endpointId: string,
  updates: { port?: number; slug?: string },
) {
  await getStackRow(orgId, stackId)

  const [endpoint] = await db
    .select()
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.id, endpointId),
      eq(zoneployPublicEndpoints.ownerType, 'stack'),
      eq(zoneployPublicEndpoints.ownerId, stackId),
      isNull(zoneployPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Zoneploy endpoint not found')

  return updateStackZoneployEndpointWithDeps(
    stackId,
    endpoint,
    endpoint.hostnameLabel,
    updates,
    {
      validateZoneploySlug: assertValidZoneploySlug,
      buildHostnameLabel: (slug) => buildZoneployHostnameLabel('stack', slug),
      removeHostsFromRedis: async (hosts) => {
        for (const host of hosts) {
          await redis.hdel(REDIS_KEYS.routesHash, host)
        }
      },
      assertUniquePort: async (ownerId, port, currentId) => {
        const [portConflict] = await db
          .select({ id: zoneployPublicEndpoints.id })
          .from(zoneployPublicEndpoints)
          .where(and(
            eq(zoneployPublicEndpoints.ownerType, 'stack'),
            eq(zoneployPublicEndpoints.ownerId, ownerId),
            eq(zoneployPublicEndpoints.port, port),
            ne(zoneployPublicEndpoints.id, currentId),
            isNull(zoneployPublicEndpoints.deletedAt),
          ))
          .limit(1)

        if (portConflict) {
          throw new AppError(409, 'ZONEPLOY_PORT_ALREADY_EXISTS', `Port ${port} already has a Zoneploy domain in this stack`)
        }
      },
      assertUniqueHostnameLabel: async (hostnameLabel, currentId) => {
        const [hostnameConflict] = await db
          .select({ id: zoneployPublicEndpoints.id })
          .from(zoneployPublicEndpoints)
          .where(and(
            eq(zoneployPublicEndpoints.hostnameLabel, hostnameLabel),
            ne(zoneployPublicEndpoints.id, currentId),
            isNull(zoneployPublicEndpoints.deletedAt),
          ))
          .limit(1)

        if (hostnameConflict) {
          throw new AppError(409, 'ZONEPLOY_HOSTNAME_IN_USE', `Subdomain ${hostnameLabel} is already in use`)
        }
      },
      persistUpdate: async (id, next) => {
        const [updated] = await db
          .update(zoneployPublicEndpoints)
          .set({
            port: next.port,
            hostnameLabel: next.hostnameLabel,
            updatedAt: new Date(),
          })
          .where(eq(zoneployPublicEndpoints.id, id))
          .returning()
        return updated
      },
      syncRuntime: syncStackRuntimeRoutes,
      formatZoneployEndpoint: formatStackZoneployEndpoint,
    },
  )
}

export async function removeStackZoneployEndpoint(orgId: string, stackId: string, endpointId: string) {
  await getStackRow(orgId, stackId)

  const [endpoint] = await db
    .select()
    .from(zoneployPublicEndpoints)
    .where(and(
      eq(zoneployPublicEndpoints.id, endpointId),
      eq(zoneployPublicEndpoints.ownerType, 'stack'),
      eq(zoneployPublicEndpoints.ownerId, stackId),
      isNull(zoneployPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Zoneploy endpoint not found')

  await removeStackZoneployEndpointWithDeps(stackId, endpoint, {
    removeHostsFromRedis: async (hosts) => {
      for (const host of hosts) {
        await redis.hdel(REDIS_KEYS.routesHash, host)
      }
    },
    deleteEndpoint: async (id) => {
      await db
        .update(zoneployPublicEndpoints)
        .set({
          isPrimary: false,
          deletedAt: new Date(),
          deleteReason: 'domain_removed',
          updatedAt: new Date(),
        })
        .where(eq(zoneployPublicEndpoints.id, id))
    },
    promoteNextPrimary: promoteNextPrimaryPublicEndpoint,
    syncRuntime: syncStackRuntimeRoutes,
  })

  return formatStackZoneployEndpoint(endpoint)
}

export async function addStackCustomEndpoint(
  orgId: string,
  stackId: string,
  input: { port: number; customDomain: string },
) {
  const routing = await resolveCustomDomainRoutingForOwner('stack', stackId)
  await assertCustomDomainLimit(orgId)
  await getStackRow(orgId, stackId)
  const counts = await getStackEndpointCounts(stackId)
  return addStackCustomEndpointWithDeps(stackId, counts.total, input, routing, {
    assertCustomDomainsEnabled: assertStackCustomDomainsEnabled,
    validateCustomDomain: validateStackCustomDomain,
    assertUniqueHostname: async (ownerId, hostname) => {
      const [existing] = await db
        .select({ id: customPublicEndpoints.id })
        .from(customPublicEndpoints)
        .where(and(
          eq(customPublicEndpoints.ownerType, 'stack'),
          eq(customPublicEndpoints.ownerId, ownerId),
          eq(customPublicEndpoints.hostname, hostname),
          isNull(customPublicEndpoints.deletedAt),
        ))
        .limit(1)

      if (existing) {
        throw new AppError(409, 'CUSTOM_DOMAIN_ALREADY_EXISTS', `Domain ${hostname} already exists in this stack`)
      }
    },
    persistCreate: async (values) => {
      const [created] = await db
        .insert(customPublicEndpoints)
        .values({
          orgId,
          ownerType: 'stack',
          ownerId: stackId,
          port: values.port,
          hostname: values.hostname,
          isPrimary: values.isPrimary,
        })
        .returning()
      return created
    },
    syncRuntime: syncStackRuntimeRoutes,
    formatCustomEndpoint: formatStackCustomEndpoint,
  })
}

export async function updateStackCustomEndpoint(
  orgId: string,
  stackId: string,
  endpointId: string,
  updates: { port?: number; customDomain?: string },
) {
  await getStackRow(orgId, stackId)
  const routing = await resolveCustomDomainRoutingForOwner('stack', stackId)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'stack'),
      eq(customPublicEndpoints.ownerId, stackId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  return updateStackCustomEndpointWithDeps(stackId, endpoint, updates, routing, {
    assertCustomDomainsEnabled: assertStackCustomDomainsEnabled,
    validateCustomDomain: validateStackCustomDomain,
    assertUniqueHostname: async (ownerId, hostname, currentId) => {
      const [conflict] = await db
        .select({ id: customPublicEndpoints.id })
        .from(customPublicEndpoints)
        .where(and(
          eq(customPublicEndpoints.ownerType, 'stack'),
          eq(customPublicEndpoints.ownerId, ownerId),
          eq(customPublicEndpoints.hostname, hostname),
          ne(customPublicEndpoints.id, currentId),
          isNull(customPublicEndpoints.deletedAt),
        ))
        .limit(1)

      if (conflict) {
        throw new AppError(409, 'CUSTOM_DOMAIN_ALREADY_EXISTS', `Domain ${hostname} already exists in this stack`)
      }
    },
    removeHostsFromRedis: async (hosts) => {
      for (const host of hosts) {
        await redis.hdel(REDIS_KEYS.routesHash, host)
      }
    },
    removeCustomDomainTls,
    persistUpdate: async (id, next) => {
      const [updated] = await db
        .update(customPublicEndpoints)
        .set({
          port: next.port,
          hostname: next.hostname,
          verified: next.verified,
          updatedAt: new Date(),
        })
        .where(eq(customPublicEndpoints.id, id))
        .returning()
      return updated
    },
    syncRuntime: syncStackRuntimeRoutes,
    formatCustomEndpoint: formatStackCustomEndpoint,
  })
}

export async function removeStackCustomEndpoint(orgId: string, stackId: string, endpointId: string) {
  await getStackRow(orgId, stackId)
  const routing = await resolveCustomDomainRoutingForOwner('stack', stackId)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'stack'),
      eq(customPublicEndpoints.ownerId, stackId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  await removeStackCustomEndpointWithDeps(stackId, endpoint, {
    removeHostsFromRedis: async (hosts) => {
      for (const host of hosts) {
        await redis.hdel(REDIS_KEYS.routesHash, host)
      }
    },
    removeCustomDomainTls,
    deleteEndpoint: async (id) => {
      await db
        .update(customPublicEndpoints)
        .set({
          isPrimary: false,
          verified: false,
          deletedAt: new Date(),
          deleteReason: 'domain_removed',
          updatedAt: new Date(),
        })
        .where(eq(customPublicEndpoints.id, id))
    },
    promoteNextPrimary: promoteNextPrimaryPublicEndpoint,
    syncRuntime: syncStackRuntimeRoutes,
  })

  return formatStackCustomEndpoint(endpoint, routing)
}

export async function verifyStackCustomEndpoint(orgId: string, stackId: string, endpointId: string) {
  await getStackRow(orgId, stackId)
  const routing = await resolveCustomDomainRoutingForOwner('stack', stackId)

  const [endpoint] = await db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.id, endpointId),
      eq(customPublicEndpoints.ownerType, 'stack'),
      eq(customPublicEndpoints.ownerId, stackId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .limit(1)

  if (!endpoint) throw new NotFoundError('Custom endpoint not found')

  return verifyStackCustomEndpointWithDeps(stackId, endpoint, routing, {
    assertCustomDomainsEnabled: assertStackCustomDomainsEnabled,
    verifyHostnamePointsToTarget,
    findVerifiedCustomDomainConflict,
    removeCustomDomainTls,
    markVerified: async (id) => {
      await db
        .update(customPublicEndpoints)
        .set({ verified: true, updatedAt: new Date() })
        .where(eq(customPublicEndpoints.id, id))
    },
    syncRuntime: syncStackRuntimeRoutes,
  })
}

export async function listStackServices(orgId: string, stackId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  const runtimeServices = await getStackAgentClient(server).listStackServices(server, stack.id, stack.projectName)
  const runtimeMap = new Map(
    runtimeServices.map(service => [service.serviceName, service] as const),
  )
  const declaredServices = listDeclaredComposeServices(stack.composeContent)
  const serviceNames = new Set([
    ...declaredServices,
    ...runtimeServices.map(service => service.serviceName),
  ])

  return Array.from(serviceNames)
    .map((serviceName) => {
      const runtime = runtimeMap.get(serviceName)
      return {
        serviceName,
        containerName: runtime?.containerName ?? '',
        dockerId: runtime?.dockerId ?? '',
        status: runtime ? mapRuntimeStatus(runtime.status) : 'stopped',
        rawStatus: runtime?.status ?? 'not_created',
      }
    })
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName))
}

async function syncStackStatusFromServices(orgId: string, stackId: string) {
  const { stack } = await getStackAndServer(orgId, stackId)
  const services = await listStackServices(orgId, stackId)
  const nextStatus = deriveStackStatusFromServices(services, stack.status)

  if (nextStatus !== stack.status) {
    await db
      .update(stacks)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(stacks.id, stack.id))
  }

  return nextStatus
}

async function assertStackServiceRuntime(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  const services = await getStackAgentClient(server).listStackServices(server, stack.id, stack.projectName)
  const service = services.find(entry => entry.serviceName === serviceName)
  if (!service) throw new NotFoundError('Servicio del stack no encontrado')
  return { stack, server, service }
}

async function assertStackServiceDefinition(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  const declaredServices = listDeclaredComposeServices(stack.composeContent)
  const existsInCompose = declaredServices.includes(serviceName)

  if (!existsInCompose) {
    const runtimeServices = await getStackAgentClient(server).listStackServices(server, stack.id, stack.projectName)
    const existsInRuntime = runtimeServices.some(entry => entry.serviceName === serviceName)
    if (!existsInRuntime) throw new NotFoundError('Servicio del stack no encontrado')
  }

  return { stack, server }
}

export async function startStack(orgId: string, stackId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  await getStackAgentClient(server).startStack(server, stack.id, stack.projectName)
  await db.update(stacks).set({ status: 'running', errorReason: null, updatedAt: new Date() }).where(eq(stacks.id, stack.id))
  await syncRedisForStackDomains(stack.id)
}

export async function stopStack(orgId: string, stackId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  await getStackAgentClient(server).stopStack(server, stack.id, stack.projectName)
  await db.update(stacks).set({ status: 'stopped', updatedAt: new Date() }).where(eq(stacks.id, stack.id))
  await clearRedisForStackDomains(stack.id)
}

export async function restartStack(orgId: string, stackId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  await getStackAgentClient(server).restartStack(server, stack.id, stack.projectName)
  await db.update(stacks).set({ status: 'running', errorReason: null, updatedAt: new Date() }).where(eq(stacks.id, stack.id))
  await syncRedisForStackDomains(stack.id)
}

export async function listStackBackups(orgId: string, stackId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  return workerClient.listStackBackups(server, stack.id, stack.projectName)
}

export async function getStackBackupPolicy(orgId: string, stackId: string) {
  const stack = await getStackRow(orgId, stackId)
  const policy = await getStackBackupPolicyRow(stackId)
  return formatStackBackupPolicy(policy, stack.id, stack.orgId)
}

export async function updateStackBackupPolicy(
  orgId: string,
  stackId: string,
  input: UpdateStackBackupPolicyInput,
) {
  const stack = await getStackRow(orgId, stackId)
  const existing = await getStackBackupPolicyRow(stackId)
  const normalized = normalizeBackupPolicyInput(input, existing)
  const now = new Date()
  const enabled = input.enabled ?? existing?.enabled ?? false
  const nextRunAt = enabled
    ? calculateNextStackBackupRun(now, normalized.intervalHours)
    : null

  const values = {
    stackId: stack.id,
    orgId: stack.orgId,
    enabled,
    intervalHours: normalized.intervalHours,
    retentionCount: normalized.retentionCount,
    storageProvider: normalized.storageProvider,
    storageConfig: normalized.storageConfig,
    nextRunAt,
    updatedAt: now,
  }

  const [policy] = await db
    .insert(stackBackupPolicies)
    .values(values)
    .onConflictDoUpdate({
      target: stackBackupPolicies.stackId,
      set: values,
    })
    .returning()

  return formatStackBackupPolicy(policy!, stack.id, stack.orgId)
}

export async function createStackBackup(orgId: string, stackId: string, options: { retentionCount?: number } = {}) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  const policy = await getStackBackupPolicyRow(stackId)
  return workerClient.createStackBackup(server, stack.id, stack.projectName, {
    retentionCount: options.retentionCount ?? policy?.retentionCount ?? 5,
    storageTarget: buildStackBackupStorageTarget(policy),
  })
}

export async function restoreStackBackup(
  orgId: string,
  stackId: string,
  backupId: string,
  options: { restartAfterRestore?: boolean } = {},
) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  const result = await workerClient.restoreStackBackup(server, stack.id, stack.projectName, backupId, options)
  await syncStackRuntimeRoutes(stackId).catch(() => null)
  return result
}

export async function deleteStackBackup(orgId: string, stackId: string, backupId: string) {
  const { stack, server } = await getStackAndServer(orgId, stackId)
  return workerClient.deleteStackBackup(server, stack.id, stack.projectName, backupId)
}

export async function startStackService(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await assertStackServiceDefinition(orgId, stackId, serviceName)
  await getStackAgentClient(server).startStackService(server, stack.id, stack.projectName, serviceName)
  await syncStackStatusFromServices(orgId, stackId)
}

export async function stopStackService(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await assertStackServiceDefinition(orgId, stackId, serviceName)
  await getStackAgentClient(server).stopStackService(server, stack.id, stack.projectName, serviceName)
  await syncStackStatusFromServices(orgId, stackId)
}

export async function restartStackService(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await assertStackServiceDefinition(orgId, stackId, serviceName)
  await getStackAgentClient(server).restartStackService(server, stack.id, stack.projectName, serviceName)
  await syncStackStatusFromServices(orgId, stackId)
}

export async function inspectStackService(orgId: string, stackId: string, serviceName: string) {
  const { stack, server } = await assertStackServiceRuntime(orgId, stackId, serviceName)
  return getStackAgentClient(server).inspectStackService(server, stack.id, stack.projectName, serviceName)
}

export async function listStackServiceFiles(orgId: string, stackId: string, serviceName: string, path: string) {
  const { stack, server } = await assertStackServiceRuntime(orgId, stackId, serviceName)
  return workerClient.listStackServiceFiles(server, stack.id, stack.projectName, serviceName, path)
}

export async function getCurrentStackServiceMetrics(orgId: string, stackId: string, serviceName: string) {
  await assertStackServiceRuntime(orgId, stackId, serviceName)

  const cached = await redis.get(REDIS_KEYS.stackServiceMetrics(stackId, serviceName))
  if (cached) return JSON.parse(cached)
  return null
}

export async function getStackServiceMetricsHistory(orgId: string, stackId: string, serviceName: string, period: '1h' | '6h' | '24h') {
  await assertStackServiceRuntime(orgId, stackId, serviceName)

  const periodMs = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 }[period]
  const since = Date.now() - periodMs

  const raw = await redis.zrangebyscore(
    REDIS_KEYS.metricsHistoryStackService(stackId, serviceName),
    since,
    '+inf',
  )

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
