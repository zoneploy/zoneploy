import { AppError } from '../../lib/errors.js'
import { buildDnsTargetInstructions } from '../../lib/verify-dns-target.js'

type StackCustomEndpointLike = {
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

type AddStackCustomEndpointDeps<TEndpoint extends StackCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  validateCustomDomain: (hostname: string) => void
  assertUniqueHostname: (stackId: string, hostname: string) => Promise<void>
  persistCreate: (values: { port: number; hostname: string; isPrimary: boolean }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (stackId: string) => Promise<unknown>
  formatCustomEndpoint: (endpoint: TEndpoint, routing: TRouting) => TFormatted
}

type UpdateStackCustomEndpointDeps<TEndpoint extends StackCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  validateCustomDomain: (hostname: string) => void
  assertUniqueHostname: (stackId: string, hostname: string, currentId: string) => Promise<void>
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  persistUpdate: (endpointId: string, updates: { port: number; hostname: string; verified: boolean }) => Promise<TEndpoint | null | undefined>
  syncRuntime: (stackId: string) => Promise<unknown>
  formatCustomEndpoint: (endpoint: TEndpoint, routing: TRouting) => TFormatted
}

type RemoveStackCustomEndpointDeps = {
  removeHostsFromRedis: (hosts: string[]) => Promise<void>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  deleteEndpoint: (endpointId: string) => Promise<void>
  promoteNextPrimary: (ownerType: 'stack', ownerId: string) => Promise<unknown>
  syncRuntime: (stackId: string) => Promise<unknown>
}

type VerifyStackCustomEndpointDeps<TRouting extends CustomRoutingLike = CustomRoutingLike> = {
  assertCustomDomainsEnabled: (routing: TRouting) => void
  verifyHostnamePointsToTarget: (hostname: string, target: string) => Promise<boolean>
  findVerifiedCustomDomainConflict: (hostname: string, claim: { kind: 'stack'; endpointId: string }) => Promise<unknown>
  removeCustomDomainTls: (hostname: string) => Promise<unknown>
  markVerified: (endpointId: string) => Promise<void>
  syncRuntime: (stackId: string) => Promise<unknown>
}

export async function addStackCustomEndpointWithDeps<TEndpoint extends StackCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike>(
  stackId: string,
  totalExistingEndpoints: number,
  input: { port: number; customDomain: string },
  routing: TRouting,
  deps: AddStackCustomEndpointDeps<TEndpoint, TFormatted, TRouting>,
) {
  deps.assertCustomDomainsEnabled(routing)

  const hostname = input.customDomain.trim().toLowerCase()
  deps.validateCustomDomain(hostname)
  await deps.assertUniqueHostname(stackId, hostname)

  const created = await deps.persistCreate({
    port: input.port,
    hostname,
    isPrimary: totalExistingEndpoints === 0,
  })

  if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'Error creating custom endpoint')

  await deps.syncRuntime(stackId)
  return deps.formatCustomEndpoint(created, routing)
}

export async function updateStackCustomEndpointWithDeps<TEndpoint extends StackCustomEndpointLike, TFormatted, TRouting extends CustomRoutingLike = CustomRoutingLike>(
  stackId: string,
  endpoint: TEndpoint,
  updates: { port?: number; customDomain?: string },
  routing: TRouting,
  deps: UpdateStackCustomEndpointDeps<TEndpoint, TFormatted, TRouting>,
) {
  const nextPort = updates.port ?? endpoint.port
  const nextHostname = updates.customDomain !== undefined
    ? updates.customDomain.trim().toLowerCase()
    : endpoint.hostname

  if (updates.customDomain !== undefined) {
    deps.assertCustomDomainsEnabled(routing)
    deps.validateCustomDomain(nextHostname)
    await deps.assertUniqueHostname(stackId, nextHostname, endpoint.id)
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

  await deps.syncRuntime(stackId)
  return deps.formatCustomEndpoint(updated, routing)
}

export async function removeStackCustomEndpointWithDeps(
  stackId: string,
  endpoint: StackCustomEndpointLike,
  deps: RemoveStackCustomEndpointDeps,
) {
  await deps.removeHostsFromRedis([endpoint.hostname])
  await deps.removeCustomDomainTls(endpoint.hostname)
  await deps.deleteEndpoint(endpoint.id)

  if (endpoint.isPrimary) {
    await deps.promoteNextPrimary('stack', stackId)
  }

  await deps.syncRuntime(stackId)
}

export async function verifyStackCustomEndpointWithDeps<TRouting extends CustomRoutingLike = CustomRoutingLike>(
  stackId: string,
  endpoint: Pick<StackCustomEndpointLike, 'id' | 'hostname'>,
  routing: TRouting,
  deps: VerifyStackCustomEndpointDeps<TRouting>,
) {
  deps.assertCustomDomainsEnabled(routing)

  const verified = await deps.verifyHostnamePointsToTarget(endpoint.hostname, routing.target)

  if (verified) {
    const conflict = await deps.findVerifiedCustomDomainConflict(endpoint.hostname, {
      kind: 'stack',
      endpointId: endpoint.id,
    })
    if (conflict) {
      throw new AppError(409, 'CUSTOM_DOMAIN_ALREADY_VERIFIED', 'This domain is already verified by another deployment')
    }

    await deps.removeCustomDomainTls(endpoint.hostname)
    await deps.markVerified(endpoint.id)
    await deps.syncRuntime(stackId)
  }

  return {
    customDomain: endpoint.hostname,
    verified,
    dnsTarget: routing.target,
    dnsRecordType: routing.recordType,
    instructions: buildDnsTargetInstructions(endpoint.hostname, routing.target),
  }
}
