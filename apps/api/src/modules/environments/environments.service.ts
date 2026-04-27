import { eq, and, isNull, count, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  addOnBindings,
  containers,
  customPublicEndpoints,
  environments,
  envSecrets,
  stacks,
  zoneployPublicEndpoints,
} from '../../db/schema.js'
import { NotFoundError, ConflictError, ForbiddenError, AppError } from '../../lib/errors.js'
import { generateSlug } from '../../lib/slug.js'
import { encrypt, decrypt } from '../../lib/crypto.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { getZoneployFullDomain } from '../../lib/public-endpoints.js'

function formatEnv(e: typeof environments.$inferSelect, containerCount = 0, stackCount = 0) {
  return {
    id: e.id,
    projectId: e.projectId,
    orgId: e.orgId,
    name: e.name,
    slug: e.slug,
    color: e.color,
    isProtected: e.isProtected,
    containerCount,
    stackCount,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

// Environments

export async function listEnvironments(orgId: string, projectId: string) {
  const rows = await db
    .select({
      env: environments,
      containerCount: count(containers.id),
    })
    .from(environments)
    .leftJoin(
      containers,
      and(eq(containers.environmentId, environments.id), isNull(containers.deletedAt)),
    )
    .where(
      and(
        eq(environments.projectId, projectId),
        eq(environments.orgId, orgId),
        isNull(environments.deletedAt),
      ),
    )
    .groupBy(environments.id)
    .orderBy(environments.createdAt)

  return rows.map(r => formatEnv(r.env, r.containerCount))
}

export async function getEnvironment(orgId: string, projectId: string, envId: string) {
  const [row] = await db
    .select({ env: environments })
    .from(environments)
    .where(
      and(
        eq(environments.id, envId),
        eq(environments.projectId, projectId),
        eq(environments.orgId, orgId),
        isNull(environments.deletedAt),
      ),
    )
    .limit(1)

  if (!row) throw new NotFoundError('Environment no encontrado')

  return formatEnv(row.env)
}

export async function createEnvironment(
  orgId: string,
  projectId: string,
  data: { name: string; color?: string; isProtected?: boolean },
) {
  const slug = generateSlug(data.name)

  const [existing] = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.projectId, projectId),
        eq(environments.slug, slug),
        isNull(environments.deletedAt),
      ),
    )
    .limit(1)

  if (existing) throw new ConflictError('Ya existe un environment con ese nombre en este proyecto')

  const [env] = await db
    .insert(environments)
    .values({
      projectId,
      orgId,
      name: data.name,
      slug,
      color: data.color ?? '#6366f1',
      isProtected: data.isProtected ?? false,
    })
    .returning()

  if (!env) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear el environment')

  return formatEnv(env)
}

export async function updateEnvironment(
  orgId: string,
  projectId: string,
  envId: string,
  data: { name?: string; color?: string; isProtected?: boolean },
) {
  const updates: Partial<typeof environments.$inferInsert> = { updatedAt: new Date() }

  if (data.name) {
    updates.name = data.name
    updates.slug = generateSlug(data.name)
  }
  if (data.color !== undefined) updates.color = data.color
  if (data.isProtected !== undefined) updates.isProtected = data.isProtected

  const [env] = await db
    .update(environments)
    .set(updates)
    .where(
      and(
        eq(environments.id, envId),
        eq(environments.projectId, projectId),
        eq(environments.orgId, orgId),
        isNull(environments.deletedAt),
      ),
    )
    .returning()

  if (!env) throw new NotFoundError('Environment no encontrado')

  return formatEnv(env)
}

export async function deleteEnvironment(orgId: string, projectId: string, envId: string) {
  const [containerRows, stackRows] = await Promise.all([
    db.select({ id: containers.id }).from(containers).where(and(eq(containers.environmentId, envId), eq(containers.orgId, orgId), isNull(containers.deletedAt))),
    db.select({ id: stacks.id }).from(stacks).where(and(eq(stacks.environmentId, envId), eq(stacks.orgId, orgId), isNull(stacks.deletedAt))),
  ])
  const containerIds = containerRows.map(row => row.id)
  const stackIds = stackRows.map(row => row.id)
  const ownerFilters = [
    ...(containerIds.length > 0 ? [{ ownerType: 'container' as const, ids: containerIds }] : []),
    ...(stackIds.length > 0 ? [{ ownerType: 'stack' as const, ids: stackIds }] : []),
  ]

  const routeHosts: string[] = []
  for (const filter of ownerFilters) {
    const [zoneployRows, customRows] = await Promise.all([
      db
        .select({ ownerType: zoneployPublicEndpoints.ownerType, hostnameLabel: zoneployPublicEndpoints.hostnameLabel })
        .from(zoneployPublicEndpoints)
        .where(and(eq(zoneployPublicEndpoints.ownerType, filter.ownerType), inArray(zoneployPublicEndpoints.ownerId, filter.ids), isNull(zoneployPublicEndpoints.deletedAt))),
      db
        .select({ hostname: customPublicEndpoints.hostname })
        .from(customPublicEndpoints)
        .where(and(eq(customPublicEndpoints.ownerType, filter.ownerType), inArray(customPublicEndpoints.ownerId, filter.ids), isNull(customPublicEndpoints.deletedAt))),
    ])
    routeHosts.push(
      ...zoneployRows.map(endpoint => getZoneployFullDomain(endpoint.ownerType, endpoint.hostnameLabel)),
      ...customRows.map(endpoint => endpoint.hostname),
    )
  }

  const now = new Date()
  await db.transaction(async tx => {
    await Promise.all([
      ...(containerIds.length > 0
        ? [
            tx.update(addOnBindings).set({ status: 'disabled', deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(addOnBindings.ownerType, 'container'), inArray(addOnBindings.ownerId, containerIds), isNull(addOnBindings.deletedAt))),
            tx.update(zoneployPublicEndpoints).set({ isPrimary: false, deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(zoneployPublicEndpoints.ownerType, 'container'), inArray(zoneployPublicEndpoints.ownerId, containerIds), isNull(zoneployPublicEndpoints.deletedAt))),
            tx.update(customPublicEndpoints).set({ isPrimary: false, verified: false, deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(customPublicEndpoints.ownerType, 'container'), inArray(customPublicEndpoints.ownerId, containerIds), isNull(customPublicEndpoints.deletedAt))),
            tx.update(containers).set({ status: 'stopped', deletedAt: now, updatedAt: now }).where(and(inArray(containers.id, containerIds), isNull(containers.deletedAt))),
          ]
        : []),
      ...(stackIds.length > 0
        ? [
            tx.update(addOnBindings).set({ status: 'disabled', deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(addOnBindings.ownerType, 'stack'), inArray(addOnBindings.ownerId, stackIds), isNull(addOnBindings.deletedAt))),
            tx.update(zoneployPublicEndpoints).set({ isPrimary: false, deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(zoneployPublicEndpoints.ownerType, 'stack'), inArray(zoneployPublicEndpoints.ownerId, stackIds), isNull(zoneployPublicEndpoints.deletedAt))),
            tx.update(customPublicEndpoints).set({ isPrimary: false, verified: false, deletedAt: now, deleteReason: 'environment_deleted', updatedAt: now }).where(and(eq(customPublicEndpoints.ownerType, 'stack'), inArray(customPublicEndpoints.ownerId, stackIds), isNull(customPublicEndpoints.deletedAt))),
            tx.update(stacks).set({ status: 'stopped', deletedAt: now, updatedAt: now }).where(and(inArray(stacks.id, stackIds), isNull(stacks.deletedAt))),
          ]
        : []),
    ])
  })

  const [env] = await db
    .update(environments)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(environments.id, envId),
        eq(environments.projectId, projectId),
        eq(environments.orgId, orgId),
        isNull(environments.deletedAt),
      ),
    )
    .returning({ id: environments.id })

  if (!env) throw new NotFoundError('Environment no encontrado')

  if (routeHosts.length > 0) {
    await redis.hdel(REDIS_KEYS.routesHash, ...routeHosts).catch(() => null)
  }
}

// Shared environment secrets

export async function listEnvSecretKeys(orgId: string, envId: string) {
  const rows = await db
    .select({
      id: envSecrets.id,
      key: envSecrets.key,
      createdAt: envSecrets.createdAt,
      updatedAt: envSecrets.updatedAt,
    })
    .from(envSecrets)
    .where(and(eq(envSecrets.environmentId, envId), eq(envSecrets.orgId, orgId)))
    .orderBy(envSecrets.key)

  return rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

export async function upsertEnvSecret(orgId: string, envId: string, key: string, value: string) {
  const { encrypted, iv, authTag } = encrypt(value)

  const [existing] = await db
    .select({ id: envSecrets.id })
    .from(envSecrets)
    .where(and(eq(envSecrets.environmentId, envId), eq(envSecrets.key, key)))
    .limit(1)

  if (existing) {
    await db
      .update(envSecrets)
      .set({ valueEncrypted: encrypted, iv, authTag, updatedAt: new Date() })
      .where(eq(envSecrets.id, existing.id))
  } else {
    await db.insert(envSecrets).values({
      environmentId: envId,
      orgId,
      key,
      valueEncrypted: encrypted,
      iv,
      authTag,
    })
  }

  return { key, created: !existing }
}

export async function deleteEnvSecret(orgId: string, envId: string, key: string) {
  const result = await db
    .delete(envSecrets)
    .where(and(eq(envSecrets.environmentId, envId), eq(envSecrets.orgId, orgId), eq(envSecrets.key, key)))
    .returning({ id: envSecrets.id })

  if (!result.length) throw new NotFoundError('Secret no encontrado')
}

/**
 * Returns decrypted environment secrets.
 * Internal deploy use only; NEVER include these in API responses.
 */
export async function getEnvSecretsDecrypted(envId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({
      key: envSecrets.key,
      valueEncrypted: envSecrets.valueEncrypted,
      iv: envSecrets.iv,
      authTag: envSecrets.authTag,
    })
    .from(envSecrets)
    .where(eq(envSecrets.environmentId, envId))

  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = decrypt({ encrypted: row.valueEncrypted, iv: row.iv, authTag: row.authTag })
  }
  return result
}
