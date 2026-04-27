import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  hasMore: boolean
  onPrev: () => void
  onNext: () => void
  /** Free label, for example "Page 3" or "1-20 of 200". Defaults to "Page {page}". */
  label?: string
  className?: string
}

export function Pagination({
  page,
  hasMore,
  onPrev,
  onNext,
  label,
  className = '',
}: PaginationProps) {
  const { t } = useTranslation()

  if (page === 1 && !hasMore) return null

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span className="text-xs text-text-secondary">
        {label ?? t('common.page', { page, defaultValue: `Página ${page}` })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={page === 1}
          onClick={onPrev}
        >
          <ChevronLeft size={13} />
          {t('common.previous')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!hasMore}
          onClick={onNext}
        >
          {t('common.next')}
          <ChevronRight size={13} />
        </Button>
      </div>
    </div>
  )
}
