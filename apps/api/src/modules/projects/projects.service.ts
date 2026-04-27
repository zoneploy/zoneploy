import { eq, and, isNull, count, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  addOnBindings,
  containers,
  customPublicEndpoints,
  environments,
  projects,
  stacks,
  zoneployPublicEndpoints,
} from '../../db/schema.js'
import { NotFoundError, ConflictError, AppError } from '../../lib/errors.js'
import { generateSlug } from '../../lib/slug.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { getZoneployFullDomain } from '../../lib/public-endpoints.js'

function formatProject(p: typeof projects.$inferSelect, envCount = 0) {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    slug: p.slug,
    description: p.description,
    environmentCount: envCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function listProjects(orgId: string) {
  const rows = await db
    .select({
      project: projects,
      envCount: count(environments.id),
    })
    .from(projects)
    .leftJoin(
      environments,
      and(eq(environments.projectId, projects.id), isNull(environments.deletedAt)),
    )
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)))
    .groupBy(projects.id)
    .orderBy(projects.createdAt)

  return rows.map(r => formatProject(r.project, r.envCount))
}

export async function getProject(orgId: string, projectId: string) {
  const [row] = await db
    .select({
      project: projects,
      envCount: count(environments.id),
    })
    .from(projects)
    .leftJoin(
      environments,
      and(eq(environments.projectId, projects.id), isNull(environments.deletedAt)),
    )
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
      ),
    )
    .groupBy(projects.id)
    .limit(1)

  if (!row) throw new NotFoundError('Proyecto no encontrado')

  return formatProject(row.project, row.envCount)
}

export async function createProject(orgId: string, data: { name: string; description?: string }) {
  const slug = generateSlug(data.name)

  // Verify slug uniqueness inside the org.
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug), isNull(projects.deletedAt)))
    .limit(1)

  if (existing) throw new ConflictError('Ya existe un proyecto con ese nombre en esta organización')

  const [project] = await db
    .insert(projects)
    .values({ orgId, name: data.name, slug, description: data.description ?? null })
    .returning()

  if (!project) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear el proyecto')

  return formatProject(project)
}

export async function updateProject(
  orgId: string,
  projectId: string,
  data: { name?: string; description?: string },
) {
  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }

  if (data.name) {
    updates.name = data.name
    updates.slug = generateSlug(data.name)
  }
  if (data.description !== undefined) updates.description = data.description

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId), isNull(projects.deletedAt)))
    .returning()

  if (!project) throw new NotFoundError('Proyecto no encontrado')

  return formatProject(project)
}

export async function deleteProject(orgId: string, projectId: string) {
  const envRows = await db
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.orgId, orgId), isNull(environments.deletedAt)))
  const envIds = envRows.map(row => row.id)

  const [containerRows, stackRows] = envIds.length > 0
    ? await Promise.all([
        db.select({ id: containers.id }).from(containers).where(and(eq(containers.orgId, orgId), inArray(containers.environmentId, envIds), isNull(containers.deletedAt))),
        db.select({ id: stacks.id }).from(stacks).where(and(eq(stacks.orgId, orgId), inArray(stacks.environmentId, envIds), isNull(stacks.deletedAt))),
      ])
    : [[], []]
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
            tx.update(addOnBindings).set({ status: 'disabled', deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(addOnBindings.ownerType, 'container'), inArray(addOnBindings.ownerId, containerIds), isNull(addOnBindings.deletedAt))),
            tx.update(zoneployPublicEndpoints).set({ isPrimary: false, deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(zoneployPublicEndpoints.ownerType, 'container'), inArray(zoneployPublicEndpoints.ownerId, containerIds), isNull(zoneployPublicEndpoints.deletedAt))),
            tx.update(customPublicEndpoints).set({ isPrimary: false, verified: false, deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(customPublicEndpoints.ownerType, 'container'), inArray(customPublicEndpoints.ownerId, containerIds), isNull(customPublicEndpoints.deletedAt))),
            tx.update(containers).set({ status: 'stopped', deletedAt: now, updatedAt: now }).where(and(inArray(containers.id, containerIds), isNull(containers.deletedAt))),
          ]
        : []),
      ...(stackIds.length > 0
        ? [
            tx.update(addOnBindings).set({ status: 'disabled', deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(addOnBindings.ownerType, 'stack'), inArray(addOnBindings.ownerId, stackIds), isNull(addOnBindings.deletedAt))),
            tx.update(zoneployPublicEndpoints).set({ isPrimary: false, deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(zoneployPublicEndpoints.ownerType, 'stack'), inArray(zoneployPublicEndpoints.ownerId, stackIds), isNull(zoneployPublicEndpoints.deletedAt))),
            tx.update(customPublicEndpoints).set({ isPrimary: false, verified: false, deletedAt: now, deleteReason: 'project_deleted', updatedAt: now }).where(and(eq(customPublicEndpoints.ownerType, 'stack'), inArray(customPublicEndpoints.ownerId, stackIds), isNull(customPublicEndpoints.deletedAt))),
            tx.update(stacks).set({ status: 'stopped', deletedAt: now, updatedAt: now }).where(and(inArray(stacks.id, stackIds), isNull(stacks.deletedAt))),
          ]
        : []),
      ...(envIds.length > 0
        ? [tx.update(environments).set({ deletedAt: now, updatedAt: now }).where(and(inArray(environments.id, envIds), isNull(environments.deletedAt)))]
        : []),
    ])
  })

  const [project] = await db
    .update(projects)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId), isNull(projects.deletedAt)))
    .returning({ id: projects.id })

  if (!project) throw new NotFoundError('Proyecto no encontrado')

  if (routeHosts.length > 0) {
    await redis.hdel(REDIS_KEYS.routesHash, ...routeHosts).catch(() => null)
  }
}
