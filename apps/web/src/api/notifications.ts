import { apiClient } from '@/lib/api-client'
import type { NotificationType } from './notificationTypes'

export interface Notification {
  id: string
  userId: string
  orgId: string | null
  type: NotificationType
  data: Record<string, unknown>
  link: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationsResponse {
  items: Notification[]
  unread: number
}

export const notificationsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    const query = qs.toString()
    return apiClient.get<NotificationsResponse>(`/notifications${query ? `?${query}` : ''}`)
  },

  markRead: (id: string) =>
    apiClient.post<Notification>(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.post<{ ok: boolean }>('/notifications/read-all'),

  delete: (id: string) =>
    apiClient.delete(`/notifications/${id}`),
}
