import { AppError } from '../../lib/errors.js'
import { getZoneployFullDomain } from '../../lib/public-endpoints.js'
import { buildDnsTargetInstructions } from '../../lib/verify-dns-target.js'

type ContainerZoneployEndpointLike = {
  id: string
  port: number
  hostnameLabel: string
  isPrimary: boolean
}

type ContainerCustomEndpointLike = {
  id: string
  hostname: string
  port: number
  verified: boolean
  isPrimary: boolean
}

type CustomRoutingLike = {
  mode: string
  target: string
  recordType: 'A' | 'AAAA' | 'CNAME' | null
}

type AddZoneployEndpointDeps<TEndpoint extends ContainerZoneployEndpointLike, TFormatted> = {
  buildHostnameLabel: (slug: string) => string
  assertUniquePort: (containerId: string, port: number) => Promise<void>
  assertUniqueHostnameLabel: (hostnameLabel: string) => Promise<void>
  persistCreate: (values: { port: number; hostnameLabel: string; isPrimary: boolean }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (containerId: string) => Promise<unknown>
  formatZoneployEndpoint: (endpoint: TEndpoint) => TFormatted
}

type UpdateZoneployEndpointDeps<TEndpoint extends ContainerZoneployEndpointLike, TFormatted> = {
  validateZoneploySlug: (slug: string) => void
  buildHostnameLabel: (slug: string) => string
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  assertUniquePort: (containerId: string, port: number, currentId: string) => Promise<void>
  assertUniqueHostnameLabel: (hostnameLabel: string, currentId: string) => Promise<void>
  persistUpdate: (endpointId: string, updates: { port: number; hostnameLabel: string }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (containerId: string) => Promise<unknown>
  formatZoneployEndpoint: (endpoint: TEndpoint) => TFormatted
}

type AddCustomEndpointDeps<TEndpoint extends ContainerCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  validateCustomDomain: (hostname: string) => void
  assertUniqueHostname: (containerId: string, hostname: string) => Promise<void>
  persistCreate: (values: { port: number; hostname: string; isPrimary: boolean }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (containerId: string) => Promise<unknown>
  formatCustomEndpoint: (endpoint: TEndpoint, routing: TRouting) => TFormatted
}

type UpdateCustomEndpointDeps<TEndpoint extends ContainerCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  validateCustomDomain: (hostname: string) => void
  assertUniqueHostname: (containerId: string, hostname: string, currentId: string) => Promise<void>
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  persistUpdate: (endpointId: string, updates: { port: number; hostname: string; verified: boolean }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (containerId: string) => Promise<unknown>
  formatCustomEndpoint: (endpoint: TEndpoint, routing: TRouting) => TFormatted
}

type RemoveZoneployEndpointDeps = {
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  deleteEndpoint: (endpointId: string) => Promise<void>
  promoteNextPrimary: (ownerType: 'container', ownerId: string) => Promise<unknown>
  syncRuntime: (containerId: string) => Promise<unknown>
}

type RemoveCustomEndpointDeps = {
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  deleteEndpoint: (endpointId: string) => Promise<void>
  promoteNextPrimary: (ownerType: 'container', ownerId: string) => Promise<unknown>
  syncRuntime: (containerId: string) => Promise<unknown>
}

type VerifyCustomEndpointDeps<TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  verifyHostnamePointsToTarget: (hostname: string, target: string) => Promise<boolean>
  findVerifiedCustomDomainConflict: (hostname: string, claim: { kind: 'container'; endpointId: string }) => Promise<unknown>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  markVerified: (endpointId: string) => Promise<void>
  syncRuntime: (containerId: string) => Promise<unknown>
}

export async function addContainerZoneployEndpointWithDeps<TEndpoint extends ContainerZoneployEndpointLike, TFormatted>(
  containerId: string,
  generatedSlug: string,
  totalExistingEndpoints: number,
  port: number,
  deps: AddZoneployEndpointDeps<TEndpoint, TFormatted>,
) {
  const hostnameLabel = deps.buildHostnameLabel(generatedSlug)

  await deps.assertUniquePort(containerId, port)
  await deps.assertUniqueHostnameLabel(hostnameLabel)

  const created = await deps.persistCreate({
    port,
    hostnameLabel,
    isPrimary: totalExistingEndpoints === 0,
  })

  if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'Error creating Zoneploy endpoint')

  await deps.syncRuntime(containerId)
  return deps.formatZoneployEndpoint(created)
}

export async function updateContainerZoneployEndpointWithDeps<TEndpoint extends ContainerZoneployEndpointLike, TFormatted>(
  containerId: string,
  endpoint: TEndpoint,
  currentSlug: string,
  updates: { port?: number; slug?: string },
  deps: UpdateZoneployEndpointDeps<TEndpoint, TFormatted>,
) {
  const nextPort = updates.port ?? endpoint.port
  const nextSlug = updates.slug !== undefined ? updates.slug.trim().toLowerCase() : currentSlug

  if (updates.slug !== undefined) {
    deps.validateZoneploySlug(nextSlug)
  }

  const nextHostnameLabel = deps.buildHostnameLabel(nextSlug)

  await deps.assertUniquePort(containerId, nextPort, endpoint.id)
  await deps.assertUniqueHostnameLabel(nextHostnameLabel, endpoint.id)

  if (nextHostnameLabel !== endpoint.hostnameLabel) {
    await deps.removeHostsFromRedis([getZoneployFullDomain('container', endpoint.hostnameLabel)])
  }

  const updated = await deps.persistUpdate(endpoint.id, {
    port: nextPort,
    hostnameLabel: nextHostnameLabel,
  })

  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'Error updating Zoneploy endpoint')

  await deps.syncRuntime(containerId)
  return deps.formatZoneployEndpoint(updated)
}

export async function addContainerCustomEndpointWithDeps<TEndpoint extends ContainerCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike>(
  containerId: string,
  totalExistingEndpoints: number,
  input: { port: number; customDomain: string },
  routing: TRouting,
  deps: AddCustomEndpointDeps<TEndpoint, TFormatted, TRouting>,
) {
  deps.assertCustomDomainsEnabled(routing)

  const hostname = input.customDomain.trim().toLowerCase()
  deps.validateCustomDomain(hostname)
  await deps.assertUniqueHostname(containerId, hostname)

  const created = await deps.persistCreate({
    port: input.port,
    hostname,
    isPrimary: totalExistingEndpoints === 0,
  })

  if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'Error creating custom endpoint')

  await deps.syncRuntime(containerId)
  return deps.formatCustomEndpoint(created, routing)
}

export async function updateContainerCustomEndpointWithDeps<TEndpoint extends ContainerCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike>(
  containerId: string,
  endpoint: TEndpoint,
  updates: { port?: number; customDomain?: string },
  routing: TRouting,
  deps: UpdateCustomEndpointDeps<TEndpoint, TFormatted, TRouting>,
) {
  const nextPort = updates.port ?? endpoint.port
  const nextHostname = updates.customDomain !== undefined
    ? updates.customDomain.trim().toLowerCase()
    : endpoint.hostname

  if (updates.customDomain !== undefined) {
    deps.assertCustomDomainsEnabled(routing)
    deps.validateCustomDomain(nextHostname)
    await deps.assertUniqueHostname(containerId, nextHostname, endpoint.id)
  }

  if (nextHostname !== endpoint.hostname) {
    await deps.removeHostsFromRedis([endpoint.hostname])
    await deps.removeCustomDomainTls(endpoint.hostname)
  }

  const updated = await deps.persistUpdate(endpoint.id, {
    port: nextPort,
    hostname: nextHostname,
    verified: nextHostname !== endpoint.hostname ? false : endpoint.verified,
  })

  if (!updated) throw new AppError(500, 'INTERNAL_ERROR', 'Error updating custom endpoint')

  await deps.syncRuntime(containerId)
  return deps.formatCustomEndpoint(updated, routing)
}

export async function removeContainerZoneployEndpointWithDeps(
  containerId: string,
  endpoint: ContainerZoneployEndpointLike,
  deps: RemoveZoneployEndpointDeps,
) {
  await deps.removeHostsFromRedis([getZoneployFullDomain('container', endpoint.hostnameLabel)])
  await deps.deleteEndpoint(endpoint.id)

  if (endpoint.isPrimary) {
    await deps.promoteNextPrimary('container', containerId)
  }

  await deps.syncRuntime(containerId)
}

export async function removeContainerCustomEndpointWithDeps(
  containerId: string,
  endpoint: ContainerCustomEndpointLike,
  deps: RemoveCustomEndpointDeps,
) {
  await deps.removeHostsFromRedis([endpoint.hostname])
  await deps.removeCustomDomainTls(endpoint.hostname)
  await deps.deleteEndpoint(endpoint.id)

  if (endpoint.isPrimary) {
    await deps.promoteNextPrimary('container', containerId)
  }

  await deps.syncRuntime(containerId)
}

export async function verifyContainerCustomEndpointWithDeps<TRouting extends CustomRoutingLike = CustomRoutingLike>(
  containerId: string,
  endpoint: Pick<ContainerCustomEndpointLike, 'id' | 'hostname'>,
  routing: TRouting,
  deps: VerifyCustomEndpointDeps<TRouting>,
) {
  deps.assertCustomDomainsEnabled(routing)

  const verified = await deps.verifyHostnamePointsToTarget(endpoint.hostname, routing.target)

  if (verified) {
    const conflict = await deps.findVerifiedCustomDomainConflict(endpoint.hostname, {
      kind: 'container',
      endpointId: endpoint.id,
    })
    if (conflict) {
      throw new AppError(409, 'CUSTOM_DOMAIN_ALREADY_VERIFIED', 'This domain is already verified by another deployment')
    }

    await deps.removeCustomDomainTls(endpoint.hostname)
    await deps.markVerified(endpoint.id)
    await deps.syncRuntime(containerId)
  }

  return {
    customDomain: endpoint.hostname,
    verified,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
    instructions: buildDnsTargetInstructions(endpoint.hostname, routing.target),
  }
}
