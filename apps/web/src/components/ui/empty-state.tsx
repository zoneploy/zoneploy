import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: React.ReactNode
}

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  subtitle?: string
  action?: EmptyStateAction
  className?: string
}

export function EmptyState({ icon: Icon, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-14 px-6 text-center', className)}>
      <Icon
        size={40}
        className="text-text-disabled mb-4"
        strokeWidth={1.2}
      />
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {subtitle && (
        <p className="text-xs text-text-secondary mt-1.5 max-w-xs leading-relaxed">{subtitle}</p>
      )}
      {action && (
        <Button size="sm" className="mt-5" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  )
}
