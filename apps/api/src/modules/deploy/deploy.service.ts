import { eq, and, isNull } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '../../db/client.js'
import { containers, organizations, stacks } from '../../db/schema.js'
import { hashDeployToken } from '../../lib/deploy-token.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'

export type DeployResourceType = 'container' | 'stack'

export interface DeployResource {
  type: DeployResourceType
  id: string
  orgId: string
  orgSlug: string
  slug: string
}

export type DeployPlanMode = 'remote-build' | 'push-to-user-registry' | 'external-image'

export interface DeployPlanInput {
  target?: DeployResourceType | 'auto'
  image?: string
}

export interface DeployPlan {
  deployId: string
  target: DeployResourceType
  mode: DeployPlanMode
  registry: null | {
    url: string
    username: string
    password: string
  }
  image: string | null
  expiresAt: string
}

function createDeployId() {
  const timestamp = new Date()
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
    .toLowerCase()

  return `${timestamp}-${randomBytes(4).toString('hex')}`
}

export async function validateDeployToken(token: string): Promise<DeployResource> {
  const hash = hashDeployToken(token)

  const [container] = await db
    .select({
      id: containers.id,
      orgId: containers.orgId,
      slug: containers.slug,
      orgSlug: organizations.slug,
    })
    .from(containers)
    .innerJoin(organizations, eq(containers.orgId, organizations.id))
    .where(and(
      eq(containers.deployTokenHash, hash),
      isNull(containers.deletedAt),
      eq(organizations.status, 'active'),
      isNull(organizations.deletedAt),
    ))
    .limit(1)

  if (container) return { type: 'container', ...container }

  const [stack] = await db
    .select({
      id: stacks.id,
      orgId: stacks.orgId,
      slug: stacks.slug,
      orgSlug: organizations.slug,
    })
    .from(stacks)
    .innerJoin(organizations, eq(stacks.orgId, organizations.id))
    .where(and(
      eq(stacks.deployTokenHash, hash),
      isNull(stacks.deletedAt),
      eq(organizations.status, 'active'),
      isNull(organizations.deletedAt),
    ))
    .limit(1)

  if (stack) return { type: 'stack', ...stack }

  throw new NotFoundError('Token invalido o revocado')
}

export async function createDeployPlan(token: string, input: DeployPlanInput = {}): Promise<DeployPlan> {
  const resource = await validateDeployToken(token)
  const requestedTarget = input.target && input.target !== 'auto' ? input.target : resource.type

  if (requestedTarget !== resource.type) {
    throw new ValidationError(`Deploy token is for ${resource.type}, not ${requestedTarget}`)
  }

  if (input.image?.trim()) {
    if (resource.type !== 'container') {
      throw new ValidationError('External image deploys are only supported for containers')
    }

    return {
      deployId: createDeployId(),
      target: resource.type,
      mode: 'external-image',
      registry: null,
      image: input.image.trim(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }
  }

  return {
    deployId: createDeployId(),
    target: resource.type,
    mode: 'remote-build',
    registry: null,
    image: null,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }
}
