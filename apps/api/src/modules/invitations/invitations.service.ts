import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../../db/client.js'
import { orgInvitations, orgMembers, organizations, users, customRoles } from '../../db/schema.js'
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../lib/errors.js'
import { sendMail, invitationEmail } from '../../lib/mailer.js'
import { config } from '../../config.js'
import type { OrgRole } from '@zoneploy/types'
import { resolvePermissions } from '../../plugins/authorize.js'

// Services.

export async function createInvitation(
  orgId: string,
  invitedByUserId: string,
  data: { email: string; role: Exclude<OrgRole, 'owner'>; customRoleId?: string },
) {
  if (data.role === 'custom' && !data.customRoleId) {
    throw new ValidationError('customRoleId es requerido cuando el rol es custom')
  }
  if (data.role === 'custom') {
    await getAssignableCustomRole(orgId, data.customRoleId!)
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  if (!org) throw new NotFoundError('Organización no encontrada')

  // Verify that the email is not already a member.
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1)

  if (existingUser[0]) {
    const alreadyMember = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, existingUser[0].id)))
      .limit(1)

    if (alreadyMember.length > 0) {
      throw new ConflictError('Este usuario ya es miembro de la organización')
    }
  }

  // Verify there is no pending invitation for the same email.
  const existingInvite = await db
    .select()
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.email, data.email),
        eq(orgInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (existingInvite.length > 0) {
    throw new ConflictError('Ya existe una invitación pendiente para este email')
  }

  const [inviter] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, invitedByUserId))
    .limit(1)

  const token = nanoid(32)
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 48)

  const [invitation] = await db
    .insert(orgInvitations)
    .values({
      orgId,
      invitedByUserId,
      email: data.email,
      role: data.role,
      customRoleId: data.customRoleId ?? null,
      token,
      expiresAt,
    })
    .returning()

  // Send the invitation email.
  const inviteUrl = `${config.APP_URL}/invite/${token}`

  const emailContent = invitationEmail({
    organizationName: org.name,
    invitedByName: inviter?.fullName ?? 'Un usuario',
    role: data.role,
    inviteUrl,
  })

  await sendMail({ to: data.email, ...emailContent })

  return invitation
}

export async function getInvitation(token: string) {
  const [invitation] = await db
    .select({
      id: orgInvitations.id,
      email: orgInvitations.email,
      role: orgInvitations.role,
      customRoleId: orgInvitations.customRoleId,
      customRoleName: customRoles.name,
      status: orgInvitations.status,
      expiresAt: orgInvitations.expiresAt,
      orgId: orgInvitations.orgId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgRequire2fa: organizations.require2fa,
      invitedByName: users.fullName,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(orgInvitations.orgId, organizations.id))
    .innerJoin(users, eq(orgInvitations.invitedByUserId, users.id))
    .leftJoin(customRoles, eq(orgInvitations.customRoleId, customRoles.id))
    .where(eq(orgInvitations.token, token))
    .limit(1)

  if (!invitation) throw new NotFoundError('Invitación no encontrada')

  if (invitation.status !== 'pending') {
    throw new ValidationError(
      `La invitación ya fue ${invitation.status === 'accepted' ? 'aceptada' : 'revocada o expirada'}`,
    )
  }

  if (new Date() > invitation.expiresAt) {
    throw new ValidationError('La invitación ha expirado')
  }

  return {
    ...invitation,
    expiresAt: invitation.expiresAt.toISOString(),
  }
}

export async function acceptInvitation(token: string, userId: string) {
  const invitation = await getInvitation(token)

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')

  if (user.email !== invitation.email) {
    throw new ForbiddenError(`Esta invitación es para ${invitation.email}. Iniciá sesión con esa cuenta.`)
  }

  if (invitation.role === 'custom') {
    if (!invitation.customRoleId) {
      throw new ValidationError('The invitation references a custom role that no longer exists')
    }
    await getAssignableCustomRole(invitation.orgId, invitation.customRoleId)
  }

  const alreadyMember = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, invitation.orgId), eq(orgMembers.userId, userId)))
    .limit(1)

  if (alreadyMember.length > 0) {
    throw new ConflictError('Ya sos miembro de esta organización')
  }

  await db.transaction(async tx => {
    await tx.insert(orgMembers).values({
      orgId: invitation.orgId,
      userId,
      role: invitation.role as OrgRole,
      customRoleId: invitation.customRoleId,
    })

    await tx
      .update(orgInvitations)
      .set({ status: 'accepted' })
      .where(eq(orgInvitations.token, token))
  })

  const permissions = await resolvePermissions(invitation.role as OrgRole, invitation.customRoleId)

  return {
    orgId: invitation.orgId,
    orgName: invitation.orgName,
    orgSlug: invitation.orgSlug,
    orgRequire2fa: invitation.orgRequire2fa,
    role: invitation.role,
    customRoleId: invitation.customRoleId,
    permissions,
  }
}

export async function declineInvitation(token: string, userId: string) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new NotFoundError('Usuario no encontrado')

  const [invitation] = await db
    .update(orgInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(orgInvitations.token, token),
        eq(orgInvitations.email, user.email),
        eq(orgInvitations.status, 'pending'),
      ),
    )
    .returning()

  if (!invitation) throw new NotFoundError('Invitación no encontrada o ya procesada')

  return { ok: true }
}

export async function revokeInvitation(orgId: string, invitationId: string) {
  const [invitation] = await db
    .update(orgInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(orgInvitations.id, invitationId),
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.status, 'pending'),
      ),
    )
    .returning()

  if (!invitation) throw new NotFoundError('Invitación no encontrada o ya procesada')

  return invitation
}

export async function listInvitations(orgId: string) {
  return db
    .select({
      id: orgInvitations.id,
      email: orgInvitations.email,
      role: orgInvitations.role,
      customRoleId: orgInvitations.customRoleId,
      customRoleName: customRoles.name,
      status: orgInvitations.status,
      expiresAt: orgInvitations.expiresAt,
      createdAt: orgInvitations.createdAt,
    })
    .from(orgInvitations)
    .leftJoin(customRoles, eq(orgInvitations.customRoleId, customRoles.id))
    .where(and(eq(orgInvitations.orgId, orgId), eq(orgInvitations.status, 'pending')))
    .orderBy(orgInvitations.createdAt)
}

async function getAssignableCustomRole(orgId: string, customRoleId: string) {
  const [role] = await db
    .select({ id: customRoles.id })
    .from(customRoles)
    .where(and(eq(customRoles.id, customRoleId), eq(customRoles.orgId, orgId)))
    .limit(1)

  if (!role) throw new NotFoundError('Rol personalizado no encontrado')
  return role
}
