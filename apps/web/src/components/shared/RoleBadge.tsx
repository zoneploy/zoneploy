import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'
import type { OrgRole } from '@zoneploy/types'

const ROLE_VARIANT: Record<OrgRole, 'default' | 'success' | 'warning' | 'muted'> = {
  owner:   'default',
  admin:   'warning',
  member:  'success',
  viewer:  'muted',
  custom:  'muted',
}

export function RoleBadge({ role, label }: { role: OrgRole; label?: string | null }) {
  const { t } = useTranslation()
  const variant = ROLE_VARIANT[role] ?? 'muted'
  return <Badge variant={variant}>{label ?? t(`members.roles.${role}`, { defaultValue: role })}</Badge>
}
