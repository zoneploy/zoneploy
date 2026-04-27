import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BellOff, CheckCheck, Trash2 } from 'lucide-react'
import { notificationsApi } from '@/api/notifications'
import { renderNotification, formatRelativeTime } from '@/lib/notificationRenderers'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { NotificationType } from '@/api/notificationTypes'

const PAGE_SIZE = 30

export function NotificationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', filter, offset],
    queryFn: () => notificationsApi.list({ limit: PAGE_SIZE, offset }),
    staleTime: 0,
  })

  const notifications = data?.items ?? []
  const unread = data?.unread ?? 0

  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.readAt)
    : notifications

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const handleClick = (id: string, link: string | null | undefined, isUnread: boolean) => {
    if (isUnread) markRead.mutate(id)
    if (link) navigate(link)
  }

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t('notifications.title')}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{t('notifications.subtitle')}</p>
        </div>
        {unread > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            loading={markAllRead.isPending}
          >
            <CheckCheck size={14} />
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>

      {/* Filter. */}
      <div className="flex items-center gap-1 bg-background-paper rounded-xl p-1 w-fit border border-grey-100">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setOffset(0) }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === f
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {t(`notifications.filter.${f}`)}
            {f === 'unread' && unread > 0 && (
              <span className={cn(
                'h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center',
                filter === 'unread' ? 'bg-white/20 text-white' : 'bg-error text-white',
              )}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List. */}
      {isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BellOff size={40} className="text-text-disabled mb-4" strokeWidth={1.2} />
          <p className="text-sm font-medium text-text-primary">
            {filter === 'unread' ? t('notifications.noUnread') : t('notifications.empty')}
          </p>
          <p className="text-xs text-text-secondary mt-1.5 max-w-xs">
            {t('notifications.emptySubtitle')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
            <tbody>
              {filtered.map(notif => {
                const isUnread = !notif.readAt
                const display = renderNotification(notif.type as NotificationType, notif.data, notif.link, t)
                const Icon = display.icon
                return (
                  <tr key={notif.id} className="group">
                    <td
                      className={cn(
                        'bg-background-paper group-hover:bg-grey-50/60 transition-colors rounded-l-xl pl-4 pr-3 py-3',
                        isUnread && 'bg-primary/[0.03]',
                      )}
                      style={{ width: '3rem' }}
                    >
                      <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', display.iconBg)}>
                        <Icon size={16} className={display.iconColor} strokeWidth={1.6} />
                      </div>
                    </td>
                    <td
                      onClick={() => handleClick(notif.id, notif.link, isUnread)}
                      className={cn(
                        'bg-background-paper group-hover:bg-grey-50/60 transition-colors px-3 py-3',
                        (isUnread || notif.link) && 'cursor-pointer',
                        isUnread && 'bg-primary/[0.03]',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text-primary leading-snug">{display.title}</p>
                          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{display.body}</p>
                        </div>
                        {isUnread && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                      </div>
                    </td>
                    <td
                      className={cn(
                        'bg-background-paper group-hover:bg-grey-50/60 transition-colors px-3 py-3 whitespace-nowrap',
                        isUnread && 'bg-primary/[0.03]',
                      )}
                      style={{ width: '8rem' }}
                    >
                      <p className="text-[11px] text-text-disabled text-right">
                        {formatRelativeTime(notif.createdAt, t)}
                      </p>
                    </td>
                    <td
                      className={cn(
                        'bg-background-paper group-hover:bg-grey-50/60 transition-colors rounded-r-xl px-3 py-3',
                        isUnread && 'bg-primary/[0.03]',
                      )}
                      style={{ width: '2.5rem' }}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 text-text-disabled hover:text-red-400 transition-all"
                        onClick={() => remove.mutate(notif.id)}
                        loading={remove.isPending && remove.variables === notif.id}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination. */}
      {!isLoading && (notifications.length === PAGE_SIZE || offset > 0) && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {t('common.prev')}
          </Button>
          <span className="text-xs text-text-secondary px-2">
            {t('common.page', { page: Math.floor(offset / PAGE_SIZE) + 1 })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={notifications.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  )
}
