import { cn } from '@/lib/utils'

const SIZE = {
  xs: 'h-3 w-3 border-[1.5px]',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[2.5px]',
}

export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent text-primary',
        SIZE[size],
        className,
      )}
    />
  )
}

/**
 * Centered container for loading states inside pages and cards.
 * Usage: <LoadingState /> or <LoadingState className="py-4" /> for compact mode.
 */
export function LoadingState({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Spinner />
    </div>
  )
}
