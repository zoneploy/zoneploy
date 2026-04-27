import {
  Zap, Server, Rocket, Users,
  AlertTriangle, CheckCircle2, XCircle, Building2,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import type { NotificationType } from '@/api/notificationTypes'

export interface NotifDisplay {
  title: string
  body: string
  icon: React.ElementType
  iconColor: string
  iconBg: string
  link?: string | null
}

type Renderer = (data: Record<string, unknown>, t: TFunction) => Omit<NotifDisplay, 'link'>

const RENDERERS: Record<NotificationType, Renderer> = {
  welcome: (_data, t) => ({
    title: t('notifications.types.welcome.title'),
    body: t('notifications.types.welcome.body'),
    icon: Zap,
    iconColor: 'text-primary',
    iconBg: 'bg-primary/10',
  }),
  org_created: (data, t) => ({
    title: t('notifications.types.org_created.title'),
    body: t('notifications.types.org_created.body', { name: data.orgName }),
    icon: Building2,
    iconColor: 'text-primary',
    iconBg: 'bg-primary/10',
  }),
  server_online: (data, t) => ({
    title: t('notifications.types.server_online.title'),
    body: t('notifications.types.server_online.body', { name: data.serverName }),
    icon: Server,
    iconColor: 'text-success',
    iconBg: 'bg-success/10',
  }),
  server_offline: (data, t) => ({
    title: t('notifications.types.server_offline.title'),
    body: t('notifications.types.server_offline.body', { name: data.serverName }),
    icon: Server,
    iconColor: 'text-error',
    iconBg: 'bg-error/10',
  }),
  server_disk_warning: (data, t) => ({
    title: t('notifications.types.server_disk_warning.title'),
    body: t('notifications.types.server_disk_warning.body', {
      name: data.serverName,
      usedPercent: data.usedPercent,
    }),
    icon: AlertTriangle,
    iconColor: 'text-warning',
    iconBg: 'bg-warning/10',
  }),
  stack_backup_failed: (data, t) => ({
    title: t('notifications.types.stack_backup_failed.title'),
    body: t('notifications.types.stack_backup_failed.body', {
      name: data.stackName,
      error: data.error,
    }),
    icon: AlertTriangle,
    iconColor: 'text-error',
    iconBg: 'bg-error/10',
  }),
  container_error: (data, t) => ({
    title: t('notifications.types.container_error.title'),
    body: t('notifications.types.container_error.body', { name: data.containerName }),
    icon: XCircle,
    iconColor: 'text-error',
    iconBg: 'bg-error/10',
  }),
  deploy_success: (data, t) => ({
    title: t('notifications.types.deploy_success.title'),
    body: t('notifications.types.deploy_success.body', { name: data.containerName }),
    icon: CheckCircle2,
    iconColor: 'text-success',
    iconBg: 'bg-success/10',
  }),
  deploy_failed: (data, t) => ({
    title: t('notifications.types.deploy_failed.title'),
    body: t('notifications.types.deploy_failed.body', { name: data.containerName }),
    icon: Rocket,
    iconColor: 'text-error',
    iconBg: 'bg-error/10',
  }),
  member_joined: (data, t) => ({
    title: t('notifications.types.member_joined.title'),
    body: t('notifications.types.member_joined.body', { name: data.memberName, org: data.orgName }),
    icon: Users,
    iconColor: 'text-primary',
    iconBg: 'bg-primary/10',
  }),
  addon_expiring: (data, t) => ({
    title: t('notifications.types.addon_expiring.title'),
    body: t('notifications.types.addon_expiring.body', { addon: data.addonName, days: data.daysLeft }),
    icon: AlertTriangle,
    iconColor: 'text-warning',
    iconBg: 'bg-warning/10',
  }),
}

export function renderNotification(
  type: NotificationType,
  data: Record<string, unknown>,
  link: string | null | undefined,
  t: TFunction,
): NotifDisplay {
  const renderer = RENDERERS[type] ?? RENDERERS.welcome
  return { ...renderer(data, t), link }
}

export function formatRelativeTime(dateStr: string, t: TFunction): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return t('notifications.time.justNow')
  if (mins < 60) return t('notifications.time.minutesAgo', { count: mins, postProcess: 'interval' })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('notifications.time.hoursAgo', { count: hours, postProcess: 'interval' })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('notifications.time.daysAgo', { count: days, postProcess: 'interval' })
  return new Date(dateStr).toLocaleDateString()
}
