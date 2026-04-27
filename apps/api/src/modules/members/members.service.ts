import { eq, and, ne } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { orgMembers, users, organizations, customRoles } from '../../db/schema.js'
import { NotFoundError, ForbiddenError, ValidationError } from '../../lib/errors.js'
import type { OrgRole } from '@zoneploy/types'
import { resolvePermissions } from '../../plugins/authorize.js'

// Services

export async function listMembers(orgId: string) {
  const rows = await db
    .select({
      id: orgMembers.id,
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
      customRoleName: customRoles.name,
      joinedAt: orgMembers.joinedAt,
      userId: users.id,
      userEmail: users.email,
      userFullName: users.fullName,
      userAvatarUrl: users.avatarUrl,
      userTotpEnabled: users.totpEnabled,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .leftJoin(customRoles, eq(orgMembers.customRoleId, customRoles.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.joinedAt)

  return rows.map(r => ({
    id: r.id,
    role: r.role,
    customRoleId: r.customRoleId,
    customRoleName: r.customRoleName,
    joinedAt: r.joinedAt.toISOString(),
    userId: r.userId,
    userEmail: r.userEmail,
    userFullName: r.userFullName,
    userAvatarUrl: r.userAvatarUrl,
    twoFactorEnabled: r.userTotpEnabled,
  }))
}

export async function getMemberAuditProfile(orgId: string, userId: string) {
  const [member] = await db
    .select({
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
      userId: users.id,
      userEmail: users.email,
      userFullName: users.fullName,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1)

  if (!member) throw new NotFoundError('Miembro no encontrado')

  return {
    ...member,
    displayName: member.userFullName || member.userEmail,
  }
}

export async function changeMemberRole(
  orgId: string,
  requesterId: string,
  targetUserId: string,
  newRole: Exclude<OrgRole, 'owner'>,
  customRoleId?: string,
) {
  if (newRole === 'custom' && !customRoleId) {
    throw new ValidationError('customRoleId es requerido cuando el rol es custom')
  }

  const customRole = newRole === 'custom'
    ? await getAssignableCustomRole(orgId, customRoleId!)
    : null

  const [requester, target] = await Promise.all([
    getMember(orgId, requesterId),
    getMember(orgId, targetUserId),
  ])

  if (!requester) throw new ForbiddenError('No sos miembro de esta organización')
  if (!target) throw new NotFoundError('Miembro no encontrado')
  await assertCanManageMembers(requester)

  if (target.role === 'owner') {
    throw new ForbiddenError('No podés cambiar el rol del Owner')
  }

  // Admin no puede modificar a otro admin
  if (requester.role === 'admin' && target.role === 'admin') {
    throw new ForbiddenError('Un Admin no puede modificar a otro Admin')
  }

  const [updated] = await db
    .update(orgMembers)
    .set({
      role: newRole,
      customRoleId: newRole === 'custom' ? customRoleId! : null,
    })
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
    .returning()

  return { ...updated, customRoleName: customRole?.name ?? null }
}

export async function removeMember(orgId: string, requesterId: string, targetUserId: string) {
  const [requester, target] = await Promise.all([
    getMember(orgId, requesterId),
    getMember(orgId, targetUserId),
  ])

  if (!requester) throw new ForbiddenError('No sos miembro de esta organización')
  if (!target) throw new NotFoundError('Miembro no encontrado')

  await assertCanManageMembers(requester)

  if (target.role === 'owner') {
    throw new ForbiddenError('No se puede remover al Owner de la organización')
  }

  if (requester.role === 'admin' && target.role === 'admin') {
    throw new ForbiddenError('Un Admin no puede remover a otro Admin')
  }

  await db.delete(orgMembers).where(
    and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)),
  )
}

export async function transferOwnership(orgId: string, currentOwnerId: string, newOwnerId: string) {
  if (currentOwnerId === newOwnerId) {
    throw new ValidationError('Ya sos el Owner')
  }

  const [owner] = await db
    .select()
    .from(orgMembers)
    .where(
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, currentOwnerId), eq(orgMembers.role, 'owner')),
    )
    .limit(1)

  if (!owner) throw new ForbiddenError('Solo el Owner puede transferir el ownership')

  const [newOwnerMember] = await db
    .select()
    .from(orgMembers)
    .where(
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, newOwnerId), ne(orgMembers.role, 'owner')),
    )
    .limit(1)

  if (!newOwnerMember) throw new NotFoundError('El nuevo Owner debe ser miembro de la organización')

  await db.transaction(async tx => {
    await tx
      .update(orgMembers)
      .set({ role: 'admin', customRoleId: null })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, currentOwnerId)))

    await tx
      .update(orgMembers)
      .set({ role: 'owner', customRoleId: null })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, newOwnerId)))

    await tx
      .update(organizations)
      .set({ ownerId: newOwnerId, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
  })
}

// Internal helper

async function getMember(orgId: string, userId: string) {
  const [member] = await db
    .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1)

  return member ?? null
}

async function assertCanManageMembers(member: { role: string; customRoleId: string | null }) {
  const permissions = await resolvePermissions(member.role as OrgRole, member.customRoleId)
  if (!permissions.includes('members:manage')) {
    throw new ForbiddenError('Permisos insuficientes')
  }
}

async function getAssignableCustomRole(orgId: string, customRoleId: string) {
  const [role] = await db
    .select({ id: customRoles.id, name: customRoles.name })
    .from(customRoles)
    .where(and(eq(customRoles.id, customRoleId), eq(customRoles.orgId, orgId)))
    .limit(1)

  if (!role) throw new NotFoundError('Rol personalizado no encontrado')
  return role
}
