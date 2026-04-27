import type { FastifyRequest, FastifyReply } from 'fastify'
import type { OrgRole, Permission } from '@zoneploy/types'
import { db } from '../db/client.js'
import { organizations, orgMembers, rolePermissions } from '../db/schema.js'
import { and, eq, isNull } from 'drizzle-orm'

// Higher index means more built-in role permissions.
// Custom roles do not participate in this hierarchy.
const ROLE_HIERARCHY: Record<Exclude<OrgRole, 'custom'>, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

const BUILT_IN_PERMISSIONS: Record<Exclude<OrgRole, 'custom'>, Permission[]> = {
  owner: [
    'projects:read', 'projects:create', 'projects:update', 'projects:delete',
    'environments:read', 'environments:create', 'environments:update', 'environments:delete', 'environments:deploy',
    'containers:read', 'containers:write', 'containers:deploy', 'containers:terminal',
    'stacks:read', 'stacks:write', 'stacks:deploy', 'stacks:terminal',
    'servers:read', 'servers:connect', 'servers:terminal',
    'members:read', 'members:manage',
    'organization:manage',
    'secrets:read', 'secrets:write',
    'audit:read',
  ],
  admin: [
    'projects:read', 'projects:create', 'projects:update', 'projects:delete',
    'environments:read', 'environments:create', 'environments:update', 'environments:delete', 'environments:deploy',
    'containers:read', 'containers:write', 'containers:deploy', 'containers:terminal',
    'stacks:read', 'stacks:write', 'stacks:deploy', 'stacks:terminal',
    'servers:read', 'servers:connect', 'servers:terminal',
    'members:read', 'members:manage',
    'organization:manage',
    'secrets:read', 'secrets:write',
    'audit:read',
  ],
  member: [
    'projects:read',
    'environments:read', 'environments:deploy',
    'containers:read', 'containers:write', 'containers:deploy', 'containers:terminal',
    'stacks:read', 'stacks:write', 'stacks:deploy', 'stacks:terminal',
    'servers:read',
    'members:read',
    'secrets:read', 'secrets:write',
  ],
  viewer: [
    'projects:read',
    'environments:read',
    'containers:read',
    'stacks:read',
    'servers:read',
    'members:read',
    'secrets:read',
  ],
}

const BUILT_IN_ROLES = ['viewer', 'member', 'admin', 'owner'] as const

function isBuiltInRole(role: OrgRole): role is Exclude<OrgRole, 'custom'> {
  return (BUILT_IN_ROLES as readonly OrgRole[]).includes(role)
}

declare module 'fastify' {
  interface FastifyRequest {
    orgMemberRole: OrgRole
    orgMemberCustomRoleId: string | null
    orgMemberPermissions: Permission[]
  }
}

async function resolveMember(orgId: string, userId: string) {
  const [member] = await db
    .select({
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(and(
      eq(orgMembers.orgId, orgId),
      eq(orgMembers.userId, userId),
      eq(organizations.status, 'active'),
      isNull(organizations.deletedAt),
    ))
    .limit(1)

  return member ?? null
}

async function resolvePermissions(role: OrgRole, customRoleId: string | null): Promise<Permission[]> {
  if (role === 'custom' && customRoleId) {
    const rows = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.customRoleId, customRoleId))

    return rows.map(r => r.permission) as Permission[]
  }

  return BUILT_IN_PERMISSIONS[role as Exclude<OrgRole, 'custom'>] ?? []
}

function rejectMissingOrg(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'orgId is required' } })
}

function rejectForbidden(reply: FastifyReply, message = 'Insufficient permissions') {
  return reply.status(403).send({ error: { code: 'FORBIDDEN', message } })
}

function attachMemberContext(request: FastifyRequest, role: OrgRole, customRoleId: string | null, permissions: Permission[]) {
  request.orgMemberRole = role
  request.orgMemberCustomRoleId = customRoleId
  request.orgMemberPermissions = permissions
}

export function authorize(minRole: Exclude<OrgRole, 'custom'>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request.params as Record<string, string>)['orgId']
    if (!orgId) return rejectMissingOrg(reply)

    const member = await resolveMember(orgId, request.userId)
    if (!member) return rejectForbidden(reply, 'You are not a member of this organization')

    const role = member.role as OrgRole
    if (!isBuiltInRole(role)) {
      return rejectForbidden(reply)
    }

    const userLevel = ROLE_HIERARCHY[role]
    const requiredLevel = ROLE_HIERARCHY[minRole]
    if (userLevel < requiredLevel) return rejectForbidden(reply)

    const permissions = await resolvePermissions(role, member.customRoleId)
    attachMemberContext(request, role, member.customRoleId, permissions)
  }
}

authorize.permission = function (required: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request.params as Record<string, string>)['orgId']
    if (!orgId) return rejectMissingOrg(reply)

    const member = await resolveMember(orgId, request.userId)
    if (!member) return rejectForbidden(reply, 'You are not a member of this organization')

    const permissions = await resolvePermissions(member.role as OrgRole, member.customRoleId)
    if (!permissions.includes(required)) return rejectForbidden(reply)

    attachMemberContext(request, member.role as OrgRole, member.customRoleId, permissions)
  }
}

authorize.any = function (required: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request.params as Record<string, string>)['orgId']
    if (!orgId) return rejectMissingOrg(reply)

    const member = await resolveMember(orgId, request.userId)
    if (!member) return rejectForbidden(reply, 'You are not a member of this organization')

    const permissions = await resolvePermissions(member.role as OrgRole, member.customRoleId)
    if (!required.some(p => permissions.includes(p))) return rejectForbidden(reply)

    attachMemberContext(request, member.role as OrgRole, member.customRoleId, permissions)
  }
}

export { BUILT_IN_PERMISSIONS, ROLE_HIERARCHY, resolvePermissions }
export type { Permission }
