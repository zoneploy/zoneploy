import bcrypt from 'bcryptjs'
import { eq, and, ne, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { orgMembers, users, organizations, customRoles, refreshTokens, passkeys } from '../../db/schema.js'
import { NotFoundError, ForbiddenError, ValidationError, ConflictError, AppError } from '../../lib/errors.js'
import type { CreateMemberInput, OrgRole } from '@zoneploy/types'
import { resolvePermissions } from '../../plugins/authorize.js'
import { createNotification } from '../notifications/notifications.service.js'

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
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)))
    .orderBy(orgMembers.joinedAt)

  return rows.map(formatMemberRow)
}

export async function createMember(
  orgId: string,
  requesterId: string,
  data: CreateMemberInput,
) {
  if (data.role === 'custom' && !data.customRoleId) {
    throw new ValidationError('customRoleId es requerido cuando el rol es custom')
  }

  const requester = await getMember(orgId, requesterId)
  if (!requester) throw new ForbiddenError('No sos miembro de esta organizacion')
  await assertCanManageMembers(requester)

  const customRole = data.role === 'custom'
    ? await getAssignableCustomRole(orgId, data.customRoleId!)
    : null

  const email = data.email.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(data.password, 12)

  const user = await db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    let userRecord: typeof users.$inferSelect

    if (existing && !existing.deletedAt) {
      if (existing.status !== 'active') {
        throw new ConflictError('El usuario existe pero no esta disponible')
      }

      const [existingMember] = await tx
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, existing.id)))
        .limit(1)

      if (existingMember) throw new ConflictError('El usuario ya es miembro de esta organizacion')
    }

    if (existing?.deletedAt) {
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, existing.id))
      await tx.delete(passkeys).where(eq(passkeys.userId, existing.id))

      const [reactivated] = await tx
        .update(users)
        .set({
          email,
          passwordHash,
          fullName: data.fullName.trim(),
          avatarUrl: null,
          status: 'active',
          emailVerified: true,
          totpSecret: null,
          totpEnabled: false,
          deletedAt: null,
          deletedByUserId: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning()

      if (!reactivated) throw new AppError(500, 'INTERNAL_ERROR', 'Error al reactivar usuario')
      userRecord = reactivated
    } else if (existing) {
      userRecord = existing
    } else {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          fullName: data.fullName.trim(),
          emailVerified: true,
        })
        .returning()

      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'Error al crear usuario')
      userRecord = created
    }

    await tx.insert(orgMembers).values({
      orgId,
      userId: userRecord.id,
      role: data.role,
      customRoleId: data.role === 'custom' ? data.customRoleId! : null,
    })

    return userRecord
  })

  createNotification({
    userId: user.id,
    orgId,
    type: 'welcome',
    data: { name: user.fullName },
    link: '/notifications',
  }).catch(err => console.error('Error creando notificacion de bienvenida:', err))

  return getMemberAuditProfile(orgId, user.id).then(member => ({
    id: member.memberId,
    role: member.role,
    customRoleId: member.customRoleId,
    customRoleName: customRole?.name ?? member.customRoleName ?? null,
    joinedAt: member.joinedAt.toISOString(),
    userId: member.userId,
    userEmail: member.userEmail,
    userFullName: member.userFullName,
    userAvatarUrl: member.userAvatarUrl,
    twoFactorEnabled: member.userTotpEnabled,
  }))
}

export async function getMemberAuditProfile(orgId: string, userId: string) {
  const [member] = await db
    .select({
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
      customRoleName: customRoles.name,
      memberId: orgMembers.id,
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
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId), isNull(users.deletedAt)))
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
  if (requesterId === targetUserId) {
    throw new ForbiddenError('No podes eliminar tu propia cuenta')
  }

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

  let softDeleted = false

  await db.transaction(async tx => {
    await tx.delete(orgMembers).where(
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)),
    )

    const [remainingMembership] = await tx
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(eq(orgMembers.userId, targetUserId))
      .limit(1)

    if (!remainingMembership) {
      await tx
        .update(users)
        .set({
          status: 'suspended',
          deletedAt: new Date(),
          deletedByUserId: requesterId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUserId))

      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, targetUserId))
      softDeleted = true
    }
  })

  return { softDeleted }
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
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId), isNull(users.deletedAt)))
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

function formatMemberRow(r: {
  id: string
  role: string
  customRoleId: string | null
  customRoleName: string | null
  joinedAt: Date
  userId: string
  userEmail: string
  userFullName: string
  userAvatarUrl: string | null
  userTotpEnabled: boolean
}) {
  return {
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
  }
}
