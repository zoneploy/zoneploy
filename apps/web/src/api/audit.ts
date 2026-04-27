import { apiClient } from '@/lib/api-client'

export interface AuditLog {
  id: string
  orgId: string
  actorId: string
  actorEmail: string
  actorName: string
  action: string
  resourceType: string | null
  resourceId: string | null
  resourceName: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

export interface AuditQuery {
  page?: number
  limit?: number
  action?: string
  actorId?: string
  resourceType?: string
  from?: string
  to?: string
}

export const auditApi = {
  list: (orgId: string, query?: AuditQuery) => {
    const params = new URLSearchParams()
    if (query?.page)         params.set('page', String(query.page))
    if (query?.limit)        params.set('limit', String(query.limit))
    if (query?.action)       params.set('action', query.action)
    if (query?.actorId)      params.set('actorId', query.actorId)
    if (query?.resourceType) params.set('resourceType', query.resourceType)
    if (query?.from)         params.set('from', query.from)
    if (query?.to)           params.set('to', query.to)
    const qs = params.toString()
    return apiClient.get<{ data: AuditLog[]; meta: { page: number; limit: number } }>(
      `/organizations/${orgId}/audit${qs ? `?${qs}` : ''}`,
    )
  },
}
