import {
  check,
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Users

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  avatarUrl: text('avatar_url'),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  emailVerified: boolean('email_verified').notNull().default(false),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const userAuthIdentities = pgTable(
  'user_auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google', 'github'] }).notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerEmail: text('provider_email'),
    providerEmailVerified: boolean('provider_email_verified').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('user_auth_identities_provider_user_idx').on(table.provider, table.providerUserId),
    index('user_auth_identities_user_idx').on(table.userId),
  ],
)

// EmailVerificationTokens

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// PasswordResetTokens

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Organizations

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  billingCountry: text('billing_country'),
  logoUrl: text('logo_url'),                           // Public URL of the optimized logo.
  logoKey: text('logo_key'),                           // Storage filename used for deletion.
  require2fa: boolean('require_2fa').notNull().default(false), // Force 2FA for members.
  status: text('status', { enum: ['active', 'suspended', 'deleted'] }).notNull().default('active'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// CustomRoles
// Custom roles per organization. Each org can define its own roles.

export const customRoles = pgTable(
  'custom_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    index('custom_roles_org_idx').on(table.orgId),
    uniqueIndex('custom_roles_org_name_idx').on(table.orgId, table.name),
  ],
)

// RolePermissions
// Permissions assigned to a custom role. Each row represents one permission, for example "containers:write".
// Valid permissions: projects:read/create/update/delete, environments:read/create/update/delete/deploy,
// containers:read/write/deploy/terminal, stacks:read/write/deploy/terminal,
// servers:read/connect/terminal, members:read/invite/manage, organization:manage,
// secrets:read/write, audit:read. Billing permissions are owner-only built-in permissions.

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customRoleId: uuid('custom_role_id').notNull().references(() => customRoles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  table => [
    uniqueIndex('role_permissions_role_perm_idx').on(table.customRoleId, table.permission),
    index('role_permissions_role_idx').on(table.customRoleId),
  ],
)

// OrgMembers

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    // Roles built-in: owner/admin/member/viewer
    // 'custom' uses customRoleId.
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer', 'custom'] }).notNull(),
    customRoleId: uuid('custom_role_id').references(() => customRoles.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('org_members_org_user_idx').on(table.orgId, table.userId),
    index('org_members_org_idx').on(table.orgId),
  ],
)

// OrgInvitations

export const orgInvitations = pgTable('org_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'member', 'viewer', 'custom'] }).notNull(),
  customRoleId: uuid('custom_role_id').references(() => customRoles.id, { onDelete: 'set null' }),
  token: text('token').notNull().unique(),
  status: text('status', {
    enum: ['pending', 'accepted', 'expired', 'revoked'],
  }).notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Plans

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  maxServers: integer('max_servers').notNull(), // -1 means unlimited.
  maxDeployments: integer('max_containers').notNull().default(-1), // containers + stacks
  maxSubdomains: integer('max_subdomains').notNull().default(-1),
  maxCustomDomains: integer('max_custom_domains').notNull().default(-1),
  maxInstalledAddOns: integer('max_installed_add_ons').notNull().default(-1),
  priceMonthlyUsd: numeric('price_monthly_usd', { precision: 10, scale: 2 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Subscriptions

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: text('status', {
    enum: ['active', 'past_due', 'canceled', 'trialing'],
  }).notNull().default('active'),
  billingProvider: text('billing_provider', { enum: ['stripe', 'mercadopago'] }),
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  canceledAt: timestamp('canceled_at'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id'),
  externalPriceId: text('external_price_id'),
  externalStatus: text('external_status'),
  paymentFailureAt: timestamp('payment_failure_at'),
  gracePeriodStartedAt: timestamp('grace_period_started_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider', { enum: ['stripe', 'mercadopago'] }).notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['received', 'processed', 'ignored', 'failed'] }).notNull().default('received'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  table => [
    uniqueIndex('billing_events_provider_event_idx').on(table.provider, table.eventId),
    index('billing_events_org_idx').on(table.orgId),
    index('billing_events_subscription_idx').on(table.subscriptionId),
  ],
)

// Projects

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('projects_org_slug_idx').on(table.orgId, table.slug),
    index('projects_org_idx').on(table.orgId),
  ],
)

// Environments

export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id), // Denormalized for fast queries.
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull().default('#6366f1'), // UI badge color.
    // Protected: only owner/admin can deploy to this environment.
    isProtected: boolean('is_protected').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('environments_project_slug_idx').on(table.projectId, table.slug),
    index('environments_project_idx').on(table.projectId),
    index('environments_org_idx').on(table.orgId),
  ],
)

// EnvSecrets
// Shared secrets at Environment scope. Injected automatically into all containers
// and stacks in the environment, merged with resource-specific secrets.

export const envSecrets = pgTable(
  'env_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('env_secrets_env_key_idx').on(table.environmentId, table.key),
    index('env_secrets_env_idx').on(table.environmentId),
  ],
)

// AuditLogs
// Immutable record of important actions. Insert only; never update or delete.

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    // Actor snapshot at action time; not an FK so history is preserved.
    actorId: uuid('actor_id').notNull(),
    actorEmail: text('actor_email').notNull(),
    actorName: text('actor_name').notNull(),
    // Action: 'member.invited' | 'member.role_changed' | 'container.created' | etc.
    action: text('action').notNull(),
    // Affected resource snapshot.
    resourceType: text('resource_type').notNull(), // 'member' | 'container' | 'project' | etc.
    resourceId: text('resource_id'),
    resourceName: text('resource_name'),
    // Additional data: { from_role: 'member', to_role: 'admin' }.
    metadata: jsonb('metadata').notNull().default({}),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  table => [
    index('audit_logs_org_created_idx').on(table.orgId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorId),
  ],
)

// Servers
// Organization VPS pool. A server can host containers from different projects
// and environments within the same org.

export const servers = pgTable(
  'servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    ipAddress: text('ip_address').notNull(),
    sshUser: text('ssh_user').notNull().default('root'),
    sshPort: integer('ssh_port').notNull().default(22),
    agentPort: integer('agent_port').notNull().default(4000),
    agentMode: text('agent_mode', { enum: ['legacy', 'self_hosted'] }).notNull().default('self_hosted'),
    agentTokenEncrypted: text('agent_token_encrypted').notNull(),
    agentTokenIv: text('agent_token_iv').notNull(),
    agentTokenAuthTag: text('agent_token_auth_tag').notNull(),
    status: text('status', {
      enum: ['provisioning', 'online', 'offline', 'error', 'disconnecting', 'updating'],
    }).notNull().default('provisioning'),
    lastHeartbeatAt: timestamp('last_heartbeat_at'),
    totalCpuCores: integer('total_cpu_cores'),
    totalMemoryMb: integer('total_memory_mb'),
    totalStorageMb: integer('total_storage_mb'),
    agentVersion: text('agent_version'),
    runtimeInfo: jsonb('runtime_info').notNull().default({}),
    capabilities: jsonb('capabilities').notNull().default({}),
    conflicts: jsonb('conflicts').notNull().default([]),
    lastPreflightAt: timestamp('last_preflight_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    index('servers_org_idx').on(table.orgId),
  ],
)

// Containers

export const containers = pgTable(
  'containers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id').references(() => environments.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id), // Denormalized.
    serverId: uuid('server_id').references(() => servers.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    image: text('image'),
    port: integer('port').notNull(),
    healthcheckPath: text('healthcheck_path'),
    status: text('status', {
      enum: ['waiting', 'created', 'deploying', 'running', 'stopped', 'error'],
    }).notNull().default('waiting'),
    errorReason: text('error_reason'),
    dockerId: text('docker_id'),
    currentDeploymentId: uuid('current_deployment_id'),
    needsRedeploy: boolean('needs_redeploy').notNull().default(false),
    deployTokenHash: text('deploy_token_hash'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('containers_env_slug_idx').on(table.environmentId, table.slug),
    index('containers_env_idx').on(table.environmentId),
    index('containers_org_idx').on(table.orgId),
    index('containers_server_idx').on(table.serverId),
  ],
)

// ContainerSecrets

export const containerSecrets = pgTable(
  'container_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    containerId: uuid('container_id').notNull().references(() => containers.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('secrets_container_key_idx').on(table.containerId, table.key),
  ],
)

// Deployments

export const containerDeployments = pgTable(
  'container_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    containerId: uuid('container_id').notNull().references(() => containers.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    serverId: uuid('server_id').notNull().references(() => servers.id),
    imageSnapshot: text('image_snapshot').notNull(),
    configSnapshot: jsonb('config_snapshot').notNull(),
    secretKeysSnapshot: text('secret_keys_snapshot').array().notNull().default([]),
    status: text('status', {
      enum: ['pending', 'running', 'success', 'failed'],
    }).notNull().default('pending'),
    triggeredBy: text('triggered_by').notNull(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  table => [
    index('deployments_container_idx').on(table.containerId),
    index('deployments_org_idx').on(table.orgId),
  ],
)

// Domains

export const zoneployPublicEndpoints = pgTable(
  'zoneploy_public_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    ownerType: text('owner_type', { enum: ['container', 'stack'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    port: integer('port').notNull(),
    hostnameLabel: text('hostname_label').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    check(
      'zoneploy_public_endpoints_owner_type_check',
      sql`${table.ownerType} in ('container', 'stack')`,
    ),
    index('zoneploy_public_endpoints_org_idx').on(table.orgId),
    index('zoneploy_public_endpoints_owner_idx').on(table.ownerType, table.ownerId),
    uniqueIndex('zoneploy_public_endpoints_hostname_active_idx').on(table.hostnameLabel).where(sql`${table.deletedAt} is null`),
    uniqueIndex('zoneploy_public_endpoints_owner_port_active_idx').on(table.ownerType, table.ownerId, table.port).where(sql`${table.deletedAt} is null`),
  ],
)

export const customPublicEndpoints = pgTable(
  'custom_public_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    ownerType: text('owner_type', { enum: ['container', 'stack'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    port: integer('port').notNull(),
    hostname: text('hostname').notNull(),
    verified: boolean('verified').notNull().default(false),
    isPrimary: boolean('is_primary').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    check(
      'custom_public_endpoints_owner_type_check',
      sql`${table.ownerType} in ('container', 'stack')`,
    ),
    index('custom_public_endpoints_org_idx').on(table.orgId),
    index('custom_public_endpoints_owner_idx').on(table.ownerType, table.ownerId),
    index('custom_public_endpoints_hostname_idx').on(table.hostname),
    uniqueIndex('custom_public_endpoints_owner_hostname_active_idx').on(table.ownerType, table.ownerId, table.hostname).where(sql`${table.deletedAt} is null`),
  ],
)

// Stacks (Docker Compose)

export const stacks = pgTable(
  'stacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id').references(() => environments.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id), // Denormalized.
    serverId: uuid('server_id').references(() => servers.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    projectName: text('project_name').notNull(),
    composeContent: text('compose_content'),
    status: text('status', {
      enum: ['created', 'deploying', 'running', 'partial', 'stopped', 'error'],
    }).notNull().default('created'),
    errorReason: text('error_reason'),
    deployTokenHash: text('deploy_token_hash'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('stacks_env_slug_idx').on(table.environmentId, table.slug),
    index('stacks_env_idx').on(table.environmentId),
    index('stacks_org_idx').on(table.orgId),
  ],
)

export const stackSecrets = pgTable(
  'stack_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stackId: uuid('stack_id').notNull().references(() => stacks.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('stack_secrets_stack_key_idx').on(table.stackId, table.key),
  ],
)

export const stackDeployments = pgTable(
  'stack_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stackId: uuid('stack_id').notNull().references(() => stacks.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    serverId: uuid('server_id').notNull().references(() => servers.id),
    composeSnapshot: text('compose_snapshot').notNull(),
    secretKeysSnapshot: text('secret_keys_snapshot').array().notNull().default([]),
    status: text('status', {
      enum: ['pending', 'running', 'success', 'failed'],
    }).notNull().default('pending'),
    triggeredBy: text('triggered_by').notNull(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  table => [
    index('stack_deployments_stack_idx').on(table.stackId),
    index('stack_deployments_org_idx').on(table.orgId),
  ],
)

export interface EncryptedBackupSecret {
  encrypted: string
  iv: string
  authTag: string
}

export interface StackBackupStorageConfig {
  endpoint?: string
  bucket?: string
  region?: string
  prefix?: string
  forcePathStyle?: boolean
  accessKeyId?: EncryptedBackupSecret
  secretAccessKey?: EncryptedBackupSecret
}

export const stackBackupPolicies = pgTable(
  'stack_backup_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stackId: uuid('stack_id').notNull().references(() => stacks.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    enabled: boolean('enabled').notNull().default(false),
    intervalHours: integer('interval_hours').notNull().default(24),
    retentionCount: integer('retention_count').notNull().default(5),
    storageProvider: text('storage_provider', { enum: ['local-vps', 's3-compatible'] }).notNull().default('local-vps'),
    storageConfig: jsonb('storage_config').$type<StackBackupStorageConfig>().notNull().default({}),
    lastRunAt: timestamp('last_run_at'),
    nextRunAt: timestamp('next_run_at'),
    lastStatus: text('last_status', { enum: ['never', 'success', 'failed'] }).notNull().default('never'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('stack_backup_policies_stack_idx').on(table.stackId),
    index('stack_backup_policies_org_idx').on(table.orgId),
    index('stack_backup_policies_due_idx').on(table.enabled, table.nextRunAt),
  ],
)

// AddOns

export type AddOnControlPlane = 'agent' | 'platform' | 'external'

export interface AddOnManagedComponent {
  name: string
  kind: 'package' | 'service' | 'container' | 'firewall' | 'proxy' | 'certificate' | 'runtime'
}

export interface AddOnUiMetadata {
  iconKey?: string
  logoKey?: string
  accentColor?: string
  summary?: string
}

export const addOns = pgTable('add_ons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull(),
  category: text('category').notNull().default('infrastructure'),
  controlPlane: text('control_plane', { enum: ['agent', 'platform', 'external'] }).notNull().default('platform'),
  installationScope: text('installation_scope', { enum: ['server'] }).notNull().default('server'),
  bindingScopes: jsonb('binding_scopes').notNull().default(['container', 'stack']),
  capabilities: jsonb('capabilities').notNull().default({}),
  requirements: jsonb('requirements').notNull().default({}),
  managedComponents: jsonb('managed_components').$type<AddOnManagedComponent[]>().notNull().default([]),
  uiMetadata: jsonb('ui_metadata').$type<AddOnUiMetadata>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// PlanAddOns

export const planAddOns = pgTable(
  'plan_add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    addOnId: uuid('add_on_id').notNull().references(() => addOns.id),
    limits: jsonb('limits').notNull().default({}),
  },
  table => [
    uniqueIndex('plan_add_ons_plan_addon_idx').on(table.planId, table.addOnId),
  ],
)

// Server Add-On Installations & Bindings

export const serverAddOnInstallations = pgTable(
  'server_add_on_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    addOnId: uuid('add_on_id').notNull().references(() => addOns.id),
    status: text('status', {
      enum: ['installing', 'active', 'suspended', 'error', 'disabled'],
    }).notNull().default('active'),
    version: text('version'),
    config: jsonb('config').notNull().default({}),
    capabilities: jsonb('capabilities').notNull().default({}),
    health: jsonb('health').notNull().default({}),
    deletedAt: timestamp('deleted_at'),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('server_add_on_installations_server_addon_active_idx').on(table.serverId, table.addOnId).where(sql`${table.deletedAt} is null`),
    index('server_add_on_installations_org_idx').on(table.orgId),
    index('server_add_on_installations_server_idx').on(table.serverId),
  ],
)

export const addOnBindings = pgTable(
  'add_on_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    serverAddOnInstallationId: uuid('server_add_on_installation_id').notNull().references(() => serverAddOnInstallations.id, { onDelete: 'cascade' }),
    ownerType: text('owner_type', { enum: ['container', 'stack'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    status: text('status', {
      enum: ['active', 'disabled'],
    }).notNull().default('active'),
    config: jsonb('config').notNull().default({}),
    deletedAt: timestamp('deleted_at'),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    uniqueIndex('add_on_bindings_installation_owner_active_idx').on(table.serverAddOnInstallationId, table.ownerType, table.ownerId).where(sql`${table.deletedAt} is null`),
    index('add_on_bindings_org_idx').on(table.orgId),
    index('add_on_bindings_owner_idx').on(table.ownerType, table.ownerId),
  ],
)

// RefreshTokens

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Passkeys (WebAuthn)

export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    deviceType: text('device_type'),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull().default('Llave de acceso'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  table => [
    index('passkeys_user_idx').on(table.userId),
  ],
)

// Notifications

export const NOTIFICATION_TYPES = [
  'welcome',
  'org_created',
  'server_online',
  'server_offline',
  'server_disk_warning',
  'stack_backup_failed',
  'container_error',
  'deploy_success',
  'deploy_failed',
  'member_joined',
  'member_invited',
  'addon_expiring',
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    // Dynamic params for frontend i18n interpolation, for example { serverName: 'my-vps' }.
    data: jsonb('data').notNull().default({}),
    // Navigation path when clicked.
    link: text('link'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  table => [
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
    index('notifications_user_read_idx').on(table.userId, table.readAt),
  ],
)
