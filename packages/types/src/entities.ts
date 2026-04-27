import type {
  UserStatus,
  OrgRole,
  OrgStatus,
  ServerAgentMode,
  ServerStatus,
  ContainerStatus,
  DeploymentStatus,
  ServerAddOnInstallationStatus,
  AddOnBindingStatus,
  StackStatus,
  Permission,
} from './enums.js'

// User

export interface User {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  status: UserStatus
  isPlatformAdmin: boolean
  emailVerified: boolean
  totpEnabled: boolean
  createdAt: string
  updatedAt: string
}

// Organization

export interface Organization {
  id: string
  name: string
  slug: string
  ownerId: string
  logoUrl: string | null
  require2fa: boolean
  status: OrgStatus
  createdAt: string
  updatedAt: string
}

// CustomRole

export interface CustomRole {
  id: string
  orgId: string
  name: string
  description: string | null
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

// OrgMember

export interface OrgMember {
  id: string
  orgId: string
  userId: string
  role: OrgRole
  customRoleId: string | null
  customRoleName?: string | null
  customRole?: Pick<CustomRole, 'id' | 'name' | 'permissions'>
  joinedAt: string
  // Expanded with user data.
  user?: Pick<User, 'id' | 'email' | 'fullName' | 'avatarUrl' | 'totpEnabled'>
}

// Project

export interface Project {
  id: string
  orgId: string
  name: string
  slug: string
  description: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  // Expandido
  environmentCount?: number
}

// Environment

export interface Environment {
  id: string
  projectId: string
  orgId: string
  name: string
  slug: string
  color: string
  isProtected: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  // Expandido
  containerCount?: number
  stackCount?: number
}

// EnvSecretKey
// Values are never exposed through the API, only keys.

export interface EnvSecretKey {
  id: string
  environmentId: string
  key: string
  createdAt: string
  updatedAt: string
}

// AuditLog

export interface AuditLog {
  id: string
  orgId: string
  actorId: string
  actorEmail: string
  actorName: string
  action: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

// Server

export interface Server {
  id: string
  orgId: string
  name: string
  ipAddress: string
  sshUser: string
  sshPort: number
  agentPort: number
  agentMode: ServerAgentMode
  status: ServerStatus
  lastHeartbeatAt: string | null
  totalCpuCores: number | null
  totalMemoryMb: number | null
  totalStorageMb: number | null
  agentVersion: string | null
  runtimeInfo: ServerRuntimeInfo
  capabilities: ServerCapabilities
  conflicts: ServerPreflightConflict[]
  lastPreflightAt: string | null
  createdAt: string
  updatedAt: string
}

export type ProvisionLogEntryType = 'step' | 'line'

export interface ProvisionLogEntry {
  type: ProvisionLogEntryType
  ts: string
  ok: boolean
  step?: string
  message?: string
  stream?: 'stdout' | 'stderr'
  error?: string
}

export interface ServerRuntimeInfo {
  platform: 'linux' | 'unknown'
  distroId: string | null
  distroLike: string[]
  kernel: string | null
  arch: string | null
  packageManager: 'apt' | 'dnf' | 'yum' | 'apk' | 'unknown'
  firewallBackend: 'ufw' | 'firewalld' | 'iptables' | 'unknown'
  systemd: boolean
  rootAccess: boolean
  elevatedAccess: 'root' | 'sudo' | 'none'
  dockerInstalled: boolean
  dockerRunning: boolean
  dockerSnapInstalled: boolean
  totalCpuCores: number | null
  totalMemoryMb: number | null
  totalStorageMb: number | null
}

export interface ServerPortListener {
  processName: string | null
  pid: number | null
}

export interface ServerPortStatus {
  port: number
  protocol: 'tcp'
  available: boolean
  listeners: ServerPortListener[]
}

export interface ServerCapabilities {
  linux: boolean
  rootAccess: boolean
  systemd: boolean
  packageManagerSupported: boolean
  dockerInstalled: boolean
  dockerRunning: boolean
  dockerSnapInstalled: boolean
  baseInstallReady: boolean
  ports: Record<string, ServerPortStatus>
}

export interface ServerPreflightConflict {
  code: string
  severity: 'error' | 'warning'
  message: string
  details: Record<string, unknown>
}

export interface ServerPreflightSummary {
  errors: number
  warnings: number
}

export interface ServerPreflightReport {
  checkedAt: string
  remoteUser: string
  runtimeInfo: ServerRuntimeInfo
  capabilities: ServerCapabilities
  conflicts: ServerPreflightConflict[]
  ports: ServerPortStatus[]
  summary: ServerPreflightSummary
}

// Container

export interface Container {
  id: string
  environmentId: string
  orgId: string
  serverId: string | null
  name: string
  slug: string
  image: string | null
  port: number
  healthcheckPath: string | null
  status: ContainerStatus
  errorReason: string | null
  currentDeploymentId: string | null
  hasDeployToken: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  // Expandido
  domain?: Domain
  server?: Pick<Server, 'id' | 'name' | 'ipAddress' | 'status'>
  environment?: Pick<Environment, 'id' | 'name' | 'color'>
}

// SecretKey

export interface SecretKey {
  id: string
  containerId: string
  key: string
  createdAt: string
  updatedAt: string
}

// Deployment

export interface Deployment {
  id: string
  containerId: string
  orgId: string
  serverId: string
  imageSnapshot: string
  configSnapshot: Record<string, unknown>
  secretKeysSnapshot: string[]
  status: DeploymentStatus
  triggeredBy: string
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

// Domain

export interface Domain {
  id: string
  containerId: string
  subdomain: string
  customDomain: string | null
  customDomainVerified: boolean
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

// AddOn

export interface AddOn {
  id: string
  name: string
  slug: string
  description: string
  category: string
  controlPlane: 'agent' | 'platform' | 'external'
  installationScope: 'server'
  bindingScopes: Array<'container' | 'stack'>
  capabilities: Record<string, unknown>
  requirements: AddOnRequirements
  managedComponents: AddOnManagedComponent[]
  uiMetadata: AddOnUiMetadata
  isActive: boolean
  createdAt: string
}

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

export interface AddOnRequirements {
  requiredCapabilities: string[]
  freeTcpPorts: number[]
}

// Server Add-On Installations & Bindings

export interface ServerAddOnInstallation {
  id: string
  serverId: string
  orgId: string
  addOnId: string
  status: ServerAddOnInstallationStatus
  version: string | null
  config: Record<string, unknown>
  capabilities: Record<string, unknown>
  health: Record<string, unknown>
  createdAt: string
  updatedAt: string
  addOn?: AddOn
}

export interface AddOnBinding {
  id: string
  orgId: string
  serverAddOnInstallationId: string
  ownerType: 'container' | 'stack'
  ownerId: string
  status: AddOnBindingStatus
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
  installation?: ServerAddOnInstallation
}

// Stack (Docker Compose)

export interface Stack {
  id: string
  environmentId: string
  orgId: string
  serverId: string | null
  name: string
  slug: string
  projectName: string
  composeContent: string | null
  status: StackStatus
  errorReason: string | null
  hasDeployToken: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  server?: Pick<Server, 'id' | 'name' | 'ipAddress' | 'status'>
  environment?: Pick<Environment, 'id' | 'name' | 'color'>
}

export interface StackSecretKey {
  id: string
  stackId: string
  key: string
  createdAt: string
  updatedAt: string
}

// Metrics

export interface ContainerMetric {
  id: string
  containerId: string
  cpuPercent: number
  memoryUsedMb: number
  storageUsedMb: number | null
  status: string
  recordedAt: string
}

export interface ServerMetric {
  id: string
  serverId: string
  cpuPercent: number
  memoryUsedMb: number
  storageUsedMb: number
  recordedAt: string
}
