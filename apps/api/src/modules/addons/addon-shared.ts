import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  addOns,
  containers,
  planAddOns,
  serverAddOnInstallations,
  servers,
  stacks,
  subscriptions,
} from '../../db/schema.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js'
import { WorkerClientError, workerClient } from '../../lib/worker-client.js'
import {
  buildCustomDomainsEdgeInstallConfig,
  CUSTOM_DOMAINS_EDGE_SLUG,
} from '../../lib/custom-domain-routing.js'
import { AGENT_MANAGED_ADDON_SLUGS } from './catalog/index.js'

export type OwnerType = 'container' | 'stack'
export type BindingScope = 'container' | 'stack'
const ENTITLED_SUBSCRIPTION_STATUSES: Array<'active' | 'trialing' | 'past_due'> = ['active', 'trialing', 'past_due']
const FIREWALL_MANAGER_SLUG = 'firewall-manager'
const DEFAULT_FIREWALL_MANAGER_SSH_PORT = 22
const DEFAULT_FIREWALL_MANAGER_AGENT_PORT = 4000
const DEFAULT_FIREWALL_MANAGER_TCP_PORTS = [DEFAULT_FIREWALL_MANAGER_SSH_PORT]

export interface AgentManagedAddonState {
  slug: string
  status: 'installing' | 'active' | 'suspended' | 'error' | 'disabled'
  version: string | null
  config: Record<string, unknown>
  capabilities: Record<string, unknown>
  health: Record<string, unknown>
}

export interface NormalizedAddonRequirements {
  requiredCapabilities: string[]
  freeTcpPorts: number[]
}

export function normalizeBindingScopes(value: unknown): BindingScope[] {
  if (!Array.isArray(value)) return []
  return value.filter((scope): scope is BindingScope => scope === 'container' || scope === 'stack')
}

export function normalizeAddonRequirements(value: unknown): NormalizedAddonRequirements {
  const record = (value ?? {}) as Record<string, unknown>

  const requiredCapabilities = Array.isArray(record.requiredCapabilities)
    ? record.requiredCapabilities.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

  const freeTcpPorts = Array.isArray(record.freeTcpPorts)
    ? record.freeTcpPorts.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry))
    : []

  return {
    requiredCapabilities,
    freeTcpPorts,
  }
}

export function normalizeServerCapabilities(value: unknown) {
  return (value ?? {}) as Record<string, unknown>
}

export function evaluateAddonRequirements(
  requirementsValue: unknown,
  serverCapabilitiesValue: unknown,
) {
  const requirements = normalizeAddonRequirements(requirementsValue)
  const serverCapabilities = normalizeServerCapabilities(serverCapabilitiesValue)
  const serverPorts = (serverCapabilities.ports ?? {}) as Record<string, { available?: boolean }>

  const missingCapabilities = requirements.requiredCapabilities.filter(
    capability => serverCapabilities[capability] !== true,
  )

  const occupiedPorts = requirements.freeTcpPorts.filter((port) => {
    const portState = serverPorts[String(port)]
    return portState?.available === false
  })

  return {
    requirements,
    missingCapabilities,
    occupiedPorts,
    compatible: missingCapabilities.length === 0 && occupiedPorts.length === 0,
  }
}

export async function getActiveSubscription(orgId: string) {
  const [sub] = await db
    .select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.status, ENTITLED_SUBSCRIPTION_STATUSES)))
    .limit(1)

  if (!sub) throw new NotFoundError('Active subscription not found')
  return sub
}

export async function ensureServerOwned(orgId: string, serverId: string) {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.orgId, orgId), isNull(servers.deletedAt)))
    .limit(1)

  if (!server) throw new NotFoundError('Server not found')
  return server
}

export function normalizeServerAddonSnapshot(server: Awaited<ReturnType<typeof ensureServerOwned>>) {
  return {
    id: server.id,
    orgId: server.orgId,
    name: server.name,
    ipAddress: server.ipAddress,
    sshUser: server.sshUser,
    sshPort: server.sshPort,
    agentPort: server.agentPort,
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

export async function ensureAddonAvailableForPlan(orgId: string, addonId: string) {
  const sub = await getActiveSubscription(orgId)
  const conditions = [eq(planAddOns.planId, sub.planId), eq(planAddOns.addOnId, addonId), eq(addOns.isActive, true)]

  const [row] = await db
    .select({
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      capabilities: addOns.capabilities,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
      isActive: addOns.isActive,
      limits: planAddOns.limits,
    })
    .from(planAddOns)
    .innerJoin(addOns, eq(planAddOns.addOnId, addOns.id))
    .where(and(...conditions))
    .limit(1)

  if (!row) throw new ForbiddenError('This add-on is not available in your plan')
  return row
}

export async function getAddonDefinition(addonId: string) {
  const [row] = await db
    .select({
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      capabilities: addOns.capabilities,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
      isActive: addOns.isActive,
    })
    .from(addOns)
    .where(eq(addOns.id, addonId))
    .limit(1)

  if (!row) throw new NotFoundError('Add-on not found')
  return row
}

export function isAgentManagedAddon(slug: string) {
  return AGENT_MANAGED_ADDON_SLUGS.has(slug)
}

export function rethrowAgentAddonError(error: unknown): never {
  if (error instanceof WorkerClientError) {
    throw new ValidationError(error.message, error.code || 'ADDON_AGENT_ERROR')
  }
  throw error
}

export function buildDesiredAddonConfig(
  addonSlug: string,
  server: Awaited<ReturnType<typeof ensureServerOwned>>,
  configValue: Record<string, unknown>,
) {
  if (addonSlug === CUSTOM_DOMAINS_EDGE_SLUG) {
    return buildCustomDomainsEdgeInstallConfig(server.ipAddress, configValue)
  }

  if (addonSlug === FIREWALL_MANAGER_SLUG) {
    const enabled = typeof configValue.enabled === 'boolean' ? configValue.enabled : true
    const sshPort = typeof server.sshPort === 'number' ? server.sshPort : DEFAULT_FIREWALL_MANAGER_SSH_PORT
    const agentPort = typeof server.agentPort === 'number' ? server.agentPort : DEFAULT_FIREWALL_MANAGER_AGENT_PORT
    const rawPorts = Array.isArray(configValue.allowedTcpPorts) ? configValue.allowedTcpPorts : []
    const allowedTcpPorts = rawPorts
      .filter((port): port is number => typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)
    const desiredTcpPorts: number[] = [
      ...(allowedTcpPorts.length > 0 ? allowedTcpPorts : DEFAULT_FIREWALL_MANAGER_TCP_PORTS),
      sshPort,
      agentPort,
    ]

    return {
      enabled,
      allowedTcpPorts: Array.from(new Set(desiredTcpPorts)).sort((a, b) => a - b),
      protectedTcpPorts: Array.from(new Set([sshPort, agentPort])).sort((a, b) => a - b),
    }
  }

  return configValue
}

export function buildAddonActionPayload(
  addonSlug: string,
  server: Awaited<ReturnType<typeof ensureServerOwned>>,
  action: string,
  payload: Record<string, unknown>,
) {
  if (addonSlug !== FIREWALL_MANAGER_SLUG || action !== 'close-port') return payload

  const sshPort = typeof server.sshPort === 'number' ? server.sshPort : DEFAULT_FIREWALL_MANAGER_SSH_PORT
  const agentPort = typeof server.agentPort === 'number' ? server.agentPort : DEFAULT_FIREWALL_MANAGER_AGENT_PORT

  return {
    ...payload,
    protectedTcpPorts: Array.from(new Set([sshPort, agentPort])).sort((a, b) => a - b),
  }
}

export function buildServerAddonInstallPlan(input: {
  addonSlug: string
  serverStatus: string
  existingStatus?: string | null
}) {
  const agentManaged = isAgentManagedAddon(input.addonSlug)

  if (input.existingStatus === 'active') {
    throw new ConflictError('The add-on is already installed on this server')
  }

  if (agentManaged && input.serverStatus !== 'online') {
    throw new ValidationError('The selected server must be online to manage this add-on')
  }

  return {
    shouldCallAgent: agentManaged,
    installationStatus: agentManaged ? 'installing' as const : 'active' as const,
    isReactivation: input.existingStatus != null,
  }
}

export function buildServerAddonConfigurePlan(input: {
  addonSlug: string
  serverStatus: string
}) {
  const agentManaged = isAgentManagedAddon(input.addonSlug)

  if (agentManaged && input.serverStatus !== 'online') {
    throw new ValidationError('The selected server must be online to manage this add-on')
  }

  return {
    shouldCallAgent: agentManaged,
  }
}

export function buildServerAddonUninstallPlan(input: {
  addonSlug: string
  serverStatus: string
  force: boolean
}) {
  const agentManaged = isAgentManagedAddon(input.addonSlug)

  if (agentManaged && !input.force && input.serverStatus !== 'online') {
    throw new ValidationError('The selected server must be online to manage this add-on')
  }

  return {
    shouldCallAgent: agentManaged && !input.force,
  }
}

export async function persistAgentManagedState(
  installationId: string,
  fallbackCapabilities: Record<string, unknown>,
  state: AgentManagedAddonState,
) {
  const [updated] = await db
    .update(serverAddOnInstallations)
    .set({
      status: state.status,
      version: state.version,
      config: state.config,
      capabilities: Object.keys(state.capabilities ?? {}).length > 0 ? state.capabilities : fallbackCapabilities,
      health: state.health ?? {},
      updatedAt: new Date(),
    })
    .where(eq(serverAddOnInstallations.id, installationId))
    .returning()

  if (!updated) throw new NotFoundError('Server add-on installation not found')

  return updated
}

export async function refreshServerPreflightSnapshot(server: Awaited<ReturnType<typeof ensureServerOwned>>) {
  if (server.status !== 'online') return server

  try {
    const report = await workerClient.getServerPreflight(server as never)
    const [updated] = await db
      .update(servers)
      .set({
        runtimeInfo: report.runtimeInfo,
        capabilities: report.capabilities,
        conflicts: report.conflicts,
        lastPreflightAt: new Date(report.checkedAt),
        totalCpuCores:
          typeof report.runtimeInfo.totalCpuCores === 'number' ? report.runtimeInfo.totalCpuCores : server.totalCpuCores,
        totalMemoryMb:
          typeof report.runtimeInfo.totalMemoryMb === 'number' ? report.runtimeInfo.totalMemoryMb : server.totalMemoryMb,
        totalStorageMb:
          typeof report.runtimeInfo.totalStorageMb === 'number' ? report.runtimeInfo.totalStorageMb : server.totalStorageMb,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, server.id))
      .returning()

    return updated ?? server
  } catch {
    return server
  }
}

export function assertAddonRequirementsCompatible(
  addon: { slug: string; requirements: unknown },
  server: Awaited<ReturnType<typeof ensureServerOwned>>,
) {
  const evaluation = evaluateAddonRequirements(addon.requirements, server.capabilities)
  if (evaluation.compatible) return

  if (addon.slug === CUSTOM_DOMAINS_EDGE_SLUG && evaluation.occupiedPorts.some(port => port === 80 || port === 443)) {
    throw new ValidationError(
      'Ports 80 and/or 443 are already in use on the selected server.',
      'EDGE_PORTS_IN_USE',
    )
  }

  const problems = [
    ...(evaluation.missingCapabilities.length > 0
      ? [`Missing capabilities: ${evaluation.missingCapabilities.join(', ')}`]
      : []),
    ...(evaluation.occupiedPorts.length > 0
      ? [`Ports already in use: ${evaluation.occupiedPorts.join(', ')}`]
      : []),
  ]

  throw new ValidationError(
    `The selected server does not meet the requirements for this add-on. ${problems.join('. ')}`.trim(),
    'ADDON_REQUIREMENTS_NOT_MET',
  )
}

export async function syncInstallationFromAgent(
  installationId: string,
  server: Awaited<ReturnType<typeof ensureServerOwned>>,
  addon: {
    slug: string
    capabilities: Record<string, unknown>
  },
) {
  if (!isAgentManagedAddon(addon.slug) || server.status !== 'online') return null

  try {
    const state = await workerClient.getAddonStatus(server as never, addon.slug)
    if (!state) return null
    return persistAgentManagedState(installationId, addon.capabilities, state)
  } catch {
    return null
  }
}

export async function getInstallationRow(orgId: string, serverId: string, addonId: string) {
  const [row] = await db
    .select()
    .from(serverAddOnInstallations)
    .where(
      and(
        eq(serverAddOnInstallations.orgId, orgId),
        eq(serverAddOnInstallations.serverId, serverId),
        eq(serverAddOnInstallations.addOnId, addonId),
        isNull(serverAddOnInstallations.deletedAt),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function getOwnerContext(orgId: string, ownerType: OwnerType, ownerId: string) {
  if (ownerType === 'container') {
    const [owner] = await db
      .select({
        id: containers.id,
        serverId: containers.serverId,
        name: containers.name,
      })
      .from(containers)
      .where(and(eq(containers.id, ownerId), eq(containers.orgId, orgId), isNull(containers.deletedAt)))
      .limit(1)

    if (!owner) throw new NotFoundError('Container not found')
    if (!owner.serverId) throw new ValidationError('The container does not have a server assigned')
    return {
      ...owner,
      serverId: owner.serverId,
    }
  }

  const [owner] = await db
    .select({
      id: stacks.id,
      serverId: stacks.serverId,
      name: stacks.name,
    })
    .from(stacks)
    .where(and(eq(stacks.id, ownerId), eq(stacks.orgId, orgId), isNull(stacks.deletedAt)))
    .limit(1)

  if (!owner) throw new NotFoundError('Stack not found')
  if (!owner.serverId) throw new ValidationError('The stack does not have a server assigned')
  return {
    ...owner,
    serverId: owner.serverId,
  }
}

export async function getInstallationWithAddon(orgId: string, installationId: string) {
  const [row] = await db
    .select({
      id: serverAddOnInstallations.id,
      orgId: serverAddOnInstallations.orgId,
      serverId: serverAddOnInstallations.serverId,
      addOnId: serverAddOnInstallations.addOnId,
      status: serverAddOnInstallations.status,
      version: serverAddOnInstallations.version,
      config: serverAddOnInstallations.config,
      capabilities: serverAddOnInstallations.capabilities,
      health: serverAddOnInstallations.health,
      createdAt: serverAddOnInstallations.createdAt,
      updatedAt: serverAddOnInstallations.updatedAt,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
    })
    .from(serverAddOnInstallations)
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(and(
      eq(serverAddOnInstallations.orgId, orgId),
      eq(serverAddOnInstallations.id, installationId),
      isNull(serverAddOnInstallations.deletedAt),
    ))
    .limit(1)

  if (!row) throw new NotFoundError('Server add-on installation not found')
  return row
}
