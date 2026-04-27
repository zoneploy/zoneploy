// Roles inside an organization.
// Built-in roles use a fixed hierarchy. Custom roles resolve permissions by customRoleId.

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'custom'

// Granular permissions used by custom roles. Built-in role grants are defined by the platform API.

export type Permission =
  | 'projects:read'    | 'projects:create'    | 'projects:update'    | 'projects:delete'
  | 'environments:read'| 'environments:create' | 'environments:update' | 'environments:delete' | 'environments:deploy'
  | 'containers:read'  | 'containers:write'    | 'containers:deploy' | 'containers:terminal'
  | 'stacks:read'      | 'stacks:write'        | 'stacks:deploy'     | 'stacks:terminal'
  | 'servers:read'     | 'servers:connect'     | 'servers:terminal'
  | 'members:read'     | 'members:invite'      | 'members:manage'
  | 'organization:manage'
  | 'secrets:read'     | 'secrets:write'
  | 'audit:read'

export const OWNER_ONLY_PERMISSIONS = [] as const satisfies readonly Permission[]

export const CUSTOM_ROLE_PERMISSIONS = [
  'projects:read', 'projects:create', 'projects:update', 'projects:delete',
  'environments:read', 'environments:create', 'environments:update', 'environments:delete', 'environments:deploy',
  'containers:read', 'containers:write', 'containers:deploy', 'containers:terminal',
  'stacks:read', 'stacks:write', 'stacks:deploy', 'stacks:terminal',
  'servers:read', 'servers:connect', 'servers:terminal',
  'members:read', 'members:invite', 'members:manage',
  'organization:manage',
  'secrets:read', 'secrets:write',
  'audit:read',
] as const satisfies readonly Permission[]

export type CustomRolePermission = typeof CUSTOM_ROLE_PERMISSIONS[number]

export type UserStatus = 'active' | 'suspended'

export type OrgStatus = 'active' | 'suspended' | 'deleted'

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing'

export type ServerStatus = 'provisioning' | 'online' | 'offline' | 'error' | 'disconnecting' | 'updating'

export type ServerAgentMode = 'legacy' | 'self_hosted'

export type ContainerStatus = 'waiting' | 'created' | 'deploying' | 'running' | 'stopped' | 'error'

export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed'

export type ServerAddOnInstallationStatus = 'installing' | 'active' | 'suspended' | 'error' | 'disabled'

export type AddOnBindingStatus = 'active' | 'disabled'

export type StackStatus = 'created' | 'deploying' | 'running' | 'partial' | 'stopped' | 'error'
