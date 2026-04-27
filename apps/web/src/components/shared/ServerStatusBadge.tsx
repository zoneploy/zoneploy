import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type ServerStatus = 'provisioning' | 'online' | 'offline' | 'error' | 'disconnecting' | 'updating'

const STATUS_CONFIG: Record<ServerStatus, { labelKey: string; dot: string; text: string }> = {
  provisioning:  { labelKey: 'servers.status.provisioning',  dot: 'bg-amber-400 animate-pulse',  text: 'text-amber-400' },
  online:        { labelKey: 'servers.status.online',        dot: 'bg-emerald-400',              text: 'text-emerald-400' },
  offline:       { labelKey: 'servers.status.offline',       dot: 'bg-slate-500',                text: 'text-slate-400' },
  error:         { labelKey: 'servers.status.error',         dot: 'bg-red-400',                  text: 'text-red-400' },
  disconnecting: { labelKey: 'servers.status.disconnecting', dot: 'bg-orange-400 animate-pulse', text: 'text-orange-400' },
  updating:      { labelKey: 'servers.status.updating',      dot: 'bg-sky-400 animate-pulse',    text: 'text-sky-400' },
}

export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const { t } = useTranslation()
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', cfg.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
      {t(cfg.labelKey)}
    </span>
  )
}
