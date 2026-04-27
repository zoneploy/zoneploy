import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type ContainerStatus = 'waiting' | 'created' | 'deploying' | 'running' | 'stopped' | 'error'

const STATUS_CONFIG: Record<ContainerStatus, { labelKey: string; dot: string; text: string }> = {
  waiting:   { labelKey: 'containers.status.waiting',   dot: 'bg-violet-400 animate-pulse', text: 'text-violet-400' },
  created:   { labelKey: 'containers.status.created',   dot: 'bg-violet-400 animate-pulse', text: 'text-violet-400' },
  deploying: { labelKey: 'containers.status.deploying', dot: 'bg-amber-400 animate-pulse',  text: 'text-amber-400' },
  running:   { labelKey: 'containers.status.running',   dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-400' },
  stopped:   { labelKey: 'containers.status.stopped',   dot: 'bg-amber-400 animate-pulse',  text: 'text-amber-400' },
  error:     { labelKey: 'containers.status.error',     dot: 'bg-red-400 animate-pulse',    text: 'text-red-400' },
}

export function ContainerStatusBadge({ status }: { status: ContainerStatus }) {
  const { t } = useTranslation()
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', cfg.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      {t(cfg.labelKey)}
    </span>
  )
}
