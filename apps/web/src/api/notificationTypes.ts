// Notification types must match the backend enum in schema.ts.
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
  'addon_expiring',
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]
