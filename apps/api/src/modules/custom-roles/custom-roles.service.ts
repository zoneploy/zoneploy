import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { customRoles, rolePermissions, orgMembers } from '../../db/schema.js'
import { NotFoundError, ConflictError, ForbiddenError, AppError } from '../../lib/errors.js'
import type { Permission } from '@zoneploy/types'

function formatRole(
  r: typeof customRoles.$inferSelect,
  permissions: Permission[],
) {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description,
    permissions,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export async function listCustomRoles(orgId: string) {
  const roles = await db
    .select()
    .from(customRoles)
    .where(eq(customRoles.orgId, orgId))
    .orderBy(customRoles.name)

  // Load permissions for all roles in a single query.
  const roleIds = roles.map(r => r.id)
  let permsRows: { customRoleId: string; permission: string }[] = []

  if (roleIds.length > 0) {
    permsRows = await db
      .select({ customRoleId: rolePermissions.customRoleId, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(inArray(rolePermissions.customRoleId, roleIds))
  }

  // Group permissions by roleId.
  const permsByRole: Record<string, Permission[]> = {}
  for (const row of permsRows) {
    if (!permsByRole[row.customRoleId]) permsByRole[row.customRoleId] = []
    permsByRole[row.customRoleId]!.push(row.permission as Permission)
  }

  return roles.map(r => formatRole(r, permsByRole[r.id] ?? []))
}

export async function getCustomRole(orgId: string, roleId: string) {
  const [role] = await db
    .select()
    .from(customRoles)
    .where(and(eq(customRoles.id, roleId), eq(customRoles.orgId, orgId)))
    .limit(1)

  if (!role) throw new NotFoundError('Role not found')

  const perms = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.customRoleId, roleId))

  return formatRole(role, perms.map(p => p.permission as Permission))
}

export async function createCustomRole(
  orgId: string,
  data: { name: string; description?: string; permissions: Permission[] },
) {
  // Name must be unique inside the org.
  const [existing] = await db
    .select({ id: customRoles.id })
    .from(customRoles)
    .where(and(eq(customRoles.orgId, orgId), eq(customRoles.name, data.name)))
    .limit(1)

  if (existing) throw new ConflictError('A role with that name already exists in this organization')

  const [role] = await db
    .insert(customRoles)
    .values({ orgId, name: data.name, description: data.description ?? null })
    .returning()

  if (!role) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create the role')

  // Insert deduplicated permissions.
  const uniquePerms = [...new Set(data.permissions)]
  if (uniquePerms.length > 0) {
    await db.insert(rolePermissions).values(
      uniquePerms.map(p => ({ customRoleId: role.id, permission: p })),
    )
  }

  return formatRole(role, uniquePerms)
}

export async function updateCustomRole(
  orgId: string,
  roleId: string,
  data: { name?: string; description?: string; permissions?: Permission[] },
) {
  // Verify that the role exists and belongs to the org.
  const [existing] = await db
    .select()
    .from(customRoles)
    .where(and(eq(customRoles.id, roleId), eq(customRoles.orgId, orgId)))
    .limit(1)

  if (!existing) throw new NotFoundError('Role not found')

  // Verify name uniqueness if it changes.
  if (data.name && data.name !== existing.name) {
    const [dup] = await db
      .select({ id: customRoles.id })
      .from(customRoles)
      .where(and(eq(customRoles.orgId, orgId), eq(customRoles.name, data.name)))
      .limit(1)

    if (dup) throw new ConflictError('A role with that name already exists in this organization')
  }

  const [updated] = await db
    .update(customRoles)
    .set({
      ...(data.name ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      updatedAt: new Date(),
    })
    .where(eq(customRoles.id, roleId))
    .returning()

  if (!updated) throw new NotFoundError('Role not found')

  // Replace permissions if provided.
  let finalPerms: Permission[]
  if (data.permissions) {
    const uniquePerms = [...new Set(data.permissions)]
    await db.delete(rolePermissions).where(eq(rolePermissions.customRoleId, roleId))
    if (uniquePerms.length > 0) {
      await db.insert(rolePermissions).values(
        uniquePerms.map(p => ({ customRoleId: roleId, permission: p })),
      )
    }
    finalPerms = uniquePerms
  } else {
    const perms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.customRoleId, roleId))
    finalPerms = perms.map(p => p.permission as Permission)
  }

  return formatRole(updated, finalPerms)
}

export async function deleteCustomRole(orgId: string, roleId: string) {
  // Verify no members are using this role.
  const [memberWithRole] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.customRoleId, roleId)))
    .limit(1)

  if (memberWithRole) {
    throw new ForbiddenError('You cannot delete a role assigned to active members')
  }

  const result = await db
    .delete(customRoles)
    .where(and(eq(customRoles.id, roleId), eq(customRoles.orgId, orgId)))
    .returning({ id: customRoles.id })

  if (!result.length) throw new NotFoundError('Role not found')
}
