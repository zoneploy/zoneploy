import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ClipboardList, Search, X,
  CalendarDays, SlidersHorizontal,
  Plus, Pencil, Trash2, ToggleLeft, UserPlus, UserMinus,
  UserCheck, ShieldPlus, ShieldMinus, ShieldCheck,
  FolderPlus, FolderX, Layers, LayersIcon, Key, KeyRound,
  Globe, Zap, ZapOff, Link, Unlink, RefreshCw, Archive,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuthStore } from '@/stores/auth'
import { auditApi, type AuditQuery } from '@/api/audit'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import { PageHeader } from '@/components/shared/PageHeader'

// Action map to { icon, colors }

type ActionStyle = { icon: React.ElementType; cls: string }

const ACTION_STYLES: Record<string, ActionStyle> = {
  'org.2fa_toggled':              { icon: ToggleLeft,  cls: 'bg-warning/10 text-warning border-warning/20' },
  'org.2fa_enabled':              { icon: ShieldPlus,  cls: 'bg-success/10 text-success border-success/20' },
  'org.2fa_disabled':             { icon: ShieldMinus, cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'org.created':                  { icon: Plus,        cls: 'bg-success/10 text-success border-success/20' },
  'org.updated':                  { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'org.logo_updated':             { icon: RefreshCw,   cls: 'bg-primary/10 text-primary border-primary/20' },
  'org.deleted':                  { icon: Trash2,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'member.invited':               { icon: UserPlus,    cls: 'bg-primary/10 text-primary border-primary/20' },
  'member.invite_revoked':        { icon: UserMinus,   cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'member.joined':                { icon: UserCheck,   cls: 'bg-success/10 text-success border-success/20' },
  'member.role_changed':          { icon: ShieldCheck, cls: 'bg-warning/10 text-warning border-warning/20' },
  'member.removed':               { icon: UserMinus,   cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'role.created':                 { icon: ShieldPlus,  cls: 'bg-success/10 text-success border-success/20' },
  'role.updated':                 { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'role.deleted':                 { icon: ShieldMinus, cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'project.created':              { icon: FolderPlus,  cls: 'bg-success/10 text-success border-success/20' },
  'project.updated':              { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'project.deleted':              { icon: FolderX,     cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'environment.created':          { icon: Layers,      cls: 'bg-success/10 text-success border-success/20' },
  'environment.updated':          { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'environment.protected_toggled':{ icon: ToggleLeft,  cls: 'bg-warning/10 text-warning border-warning/20' },
  'environment.deleted':          { icon: LayersIcon,  cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'env_secret.created':           { icon: Key,         cls: 'bg-success/10 text-success border-success/20' },
  'env_secret.updated':           { icon: Key,         cls: 'bg-primary/10 text-primary border-primary/20' },
  'env_secret.deleted':           { icon: Key,         cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'container.created':            { icon: Plus,        cls: 'bg-success/10 text-success border-success/20' },
  'container.updated':            { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'container.deleted':            { icon: Trash2,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'container.deployed':           { icon: Zap,         cls: 'bg-primary/10 text-primary border-primary/20' },
  'container.started':            { icon: Zap,         cls: 'bg-success/10 text-success border-success/20' },
  'container.stopped':            { icon: ZapOff,      cls: 'bg-warning/10 text-warning border-warning/20' },
  'container.restarted':          { icon: RefreshCw,   cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.created':                { icon: Plus,        cls: 'bg-success/10 text-success border-success/20' },
  'stack.updated':                { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.deleted':                { icon: Trash2,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'stack.deployed':               { icon: Zap,         cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.started':                { icon: Zap,         cls: 'bg-success/10 text-success border-success/20' },
  'stack.stopped':                { icon: ZapOff,      cls: 'bg-warning/10 text-warning border-warning/20' },
  'stack.restarted':              { icon: RefreshCw,   cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.backup_created':         { icon: Archive,     cls: 'bg-success/10 text-success border-success/20' },
  'stack.backup_restored':        { icon: RefreshCw,   cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.backup_deleted':         { icon: Trash2,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'stack.backup_policy_updated':  { icon: SlidersHorizontal, cls: 'bg-primary/10 text-primary border-primary/20' },
  'stack.service_started':        { icon: Zap,         cls: 'bg-success/10 text-success border-success/20' },
  'stack.service_stopped':        { icon: ZapOff,      cls: 'bg-warning/10 text-warning border-warning/20' },
  'stack.service_restarted':      { icon: RefreshCw,   cls: 'bg-primary/10 text-primary border-primary/20' },
  'server.connected':             { icon: Link,        cls: 'bg-success/10 text-success border-success/20' },
  'server.disconnected':          { icon: Unlink,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'server.updated':               { icon: Pencil,      cls: 'bg-primary/10 text-primary border-primary/20' },
  'server.docker_cleanup':        { icon: Trash2,      cls: 'bg-warning/10 text-warning border-warning/20' },
  'server.deleted':               { icon: Unlink,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'secret.created':               { icon: KeyRound,    cls: 'bg-success/10 text-success border-success/20' },
  'secret.updated':               { icon: KeyRound,    cls: 'bg-primary/10 text-primary border-primary/20' },
  'secret.deleted':               { icon: KeyRound,    cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'domain.added':                 { icon: Globe,       cls: 'bg-success/10 text-success border-success/20' },
  'domain.removed':               { icon: Globe,       cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'domain.zoneploy.created':      { icon: Globe,       cls: 'bg-success/10 text-success border-success/20' },
  'domain.zoneploy.updated':      { icon: Globe,       cls: 'bg-primary/10 text-primary border-primary/20' },
  'domain.zoneploy.deleted':      { icon: Globe,       cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'domain.custom.created':        { icon: Globe,       cls: 'bg-success/10 text-success border-success/20' },
  'domain.custom.updated':        { icon: Globe,       cls: 'bg-primary/10 text-primary border-primary/20' },
  'domain.custom.deleted':        { icon: Globe,       cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'domain.custom.verified':       { icon: Globe,       cls: 'bg-success/10 text-success border-success/20' },
  'addon.activated':              { icon: Zap,         cls: 'bg-success/10 text-success border-success/20' },
  'addon.deactivated':            { icon: ZapOff,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'addon.installed':              { icon: Zap,         cls: 'bg-success/10 text-success border-success/20' },
  'addon.configured':             { icon: SlidersHorizontal, cls: 'bg-primary/10 text-primary border-primary/20' },
  'addon.backend_action':         { icon: SlidersHorizontal, cls: 'bg-primary/10 text-primary border-primary/20' },
  'addon.uninstalled':            { icon: ZapOff,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'addon.bound':                  { icon: Link,        cls: 'bg-success/10 text-success border-success/20' },
  'addon.binding_configured':     { icon: SlidersHorizontal, cls: 'bg-primary/10 text-primary border-primary/20' },
  'addon.unbound':                { icon: Unlink,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  'deploy_token.created':         { icon: Plus,        cls: 'bg-success/10 text-success border-success/20' },
  'deploy_token.deleted':         { icon: Trash2,      cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
}

const VERB_STYLES: [string, ActionStyle][] = [
  ['created',     { icon: Plus,       cls: 'bg-success/10 text-success border-success/20' }],
  ['updated',     { icon: Pencil,     cls: 'bg-primary/10 text-primary border-primary/20' }],
  ['deleted',     { icon: Trash2,     cls: 'bg-red-500/10 text-red-400 border-red-500/20' }],
  ['toggled',     { icon: ToggleLeft, cls: 'bg-warning/10 text-warning border-warning/20' }],
  ['joined',      { icon: UserCheck,  cls: 'bg-success/10 text-success border-success/20' }],
  ['invited',     { icon: UserPlus,   cls: 'bg-primary/10 text-primary border-primary/20' }],
  ['revoked',     { icon: UserMinus,  cls: 'bg-red-500/10 text-red-400 border-red-500/20' }],
  ['changed',     { icon: RefreshCw,  cls: 'bg-warning/10 text-warning border-warning/20' }],
  ['removed',     { icon: Trash2,     cls: 'bg-red-500/10 text-red-400 border-red-500/20' }],
  ['deployed',    { icon: Zap,        cls: 'bg-primary/10 text-primary border-primary/20' }],
  ['connected',   { icon: Link,       cls: 'bg-success/10 text-success border-success/20' }],
  ['activated',   { icon: Zap,        cls: 'bg-success/10 text-success border-success/20' }],
  ['deactivated', { icon: ZapOff,     cls: 'bg-red-500/10 text-red-400 border-red-500/20' }],
  ['added',       { icon: Plus,       cls: 'bg-success/10 text-success border-success/20' }],
]

function getDisplayAction(action: string, metadata?: Record<string, unknown> | null) {
  if (action !== 'org.2fa_toggled') return action

  if (metadata?.require2fa === true) return 'org.2fa_enabled'
  if (metadata?.require2fa === false) return 'org.2fa_disabled'

  return action
}

function ActionBadge({
  action,
  metadata,
}: {
  action: string
  metadata?: Record<string, unknown> | null
}) {
  const { t } = useTranslation()
  const displayAction = getDisplayAction(action, metadata)
  const style =
    ACTION_STYLES[displayAction] ??
    VERB_STYLES.find(([v]) => displayAction.includes(v))?.[1] ??
    { icon: RefreshCw, cls: 'bg-grey-100 text-text-secondary border-grey-200' }

  const Icon = style.icon
  const label = t(`audit.actions.${displayAction}`, { defaultValue: displayAction })

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style.cls}`}>
      <Icon size={10} strokeWidth={2.5} />
      {label}
    </span>
  )
}

// Actor avatar initials

const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-purple-500/15 text-purple-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-pink-500/15 text-pink-400',
]

function ActorAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0]?.toUpperCase() ?? '')
    .join('')
  const colorIdx = name.charCodeAt(0) % AVATAR_COLORS.length
  return (
    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold select-none ${AVATAR_COLORS[colorIdx]}`}>
      {initials || '?'}
    </div>
  )
}

// Available resource types

const RESOURCE_TYPES = [
  'organization', 'server', 'container', 'stack', 'project', 'environment',
  'custom_role', 'member', 'invitation', 'secret', 'env_secret', 'domain',
  'addon', 'addon_binding', 'deploy_token',
]

const PAGE_LIMIT = 20

// Numbered pagination

function NumericPagination({
  page,
  hasMore,
  onPage,
}: {
  page: number
  hasMore: boolean
  onPage: (p: number) => void
}) {
  if (page === 1 && !hasMore) return null

  // Shows up to 3 pages centered on the current one.
  const pages: number[] = []
  if (page > 1) pages.push(page - 1)
  pages.push(page)
  if (hasMore) pages.push(page + 1)

  return (
    <div className="flex items-center gap-1">
      <button
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-grey-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={14} />
      </button>

      {pages.map(p => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className={`flex h-7 min-w-[28px] items-center justify-center rounded-md px-1 text-xs font-medium transition-colors ${
            p === page
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:bg-grey-100'
          }`}
        >
          {p}
        </button>
      ))}

      <button
        disabled={!hasMore}
        onClick={() => onPage(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-grey-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// Main page

export function AuditLogPage() {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''

  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Omit<AuditQuery, 'page' | 'limit'>>({})
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const query: AuditQuery = { page, limit: PAGE_LIMIT, ...filters }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', orgId, query],
    queryFn: () => auditApi.list(orgId, query),
    enabled: !!orgId,
  })

  const logs = data?.data ?? []
  const hasMore = logs.length === PAGE_LIMIT

  const applyFilters = () => {
    setPage(1)
    setFilters({
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(fromInput ? { from: new Date(fromInput).toISOString() } : {}),
      ...(toInput ? { to: new Date(toInput).toISOString() } : {}),
    })
  }

  const clearFilters = () => {
    setFilters({})
    setActionFilter('')
    setResourceType('')
    setFromInput('')
    setToInput('')
    setPage(1)
  }

  const hasFilters = Object.keys(filters).length > 0

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })

  // Consistent select/input styles.
  const inputCls = 'h-8 rounded-lg border border-grey-200 bg-background-paper px-3 text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors'

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        action={hasFilters && (
          <Button variant="ghost" onClick={clearFilters} className="text-text-secondary">
            <X size={14} />{t('audit.clearFilters')}
          </Button>
        )}
      />

      {/* Filter bar. */}
      <div className="space-y-2">
        {/* Main search. */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            placeholder={t('audit.filterAction')}
            className="h-10 w-full rounded-xl border border-grey-200 bg-background-paper pl-9 pr-4 text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
          />
          {actionFilter && (
            <button
              onClick={() => setActionFilter('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-primary transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Secondary filters. */}
        <div className="flex flex-wrap gap-2 items-center">
          <SlidersHorizontal size={13} className="text-text-disabled shrink-0" />

          {/* Resource type. */}
          <div className="relative">
            <Select
              value={resourceType}
              onChange={e => setResourceType(e.target.value)}
              className={`${inputCls} pl-3 pr-8 cursor-pointer`}
            >
              <option value="">{t('audit.allResources')}</option>
              {RESOURCE_TYPES.map(rt => (
                <option key={rt} value={rt}>{t(`audit.resourceTypes.${rt}`, { defaultValue: rt })}</option>
              ))}
            </Select>
          </div>

          <div className="h-4 w-px bg-grey-200" />

          {/* From date. */}
          <div className="relative flex items-center">
            <CalendarDays size={12} className="absolute left-2.5 text-text-disabled pointer-events-none" />
            <input
              type="date"
              value={fromInput}
              onChange={e => setFromInput(e.target.value)}
              title={t('audit.filterFrom')}
              className={`${inputCls} pl-8 [color-scheme:dark]`}
            />
          </div>

          <span className="text-xs text-text-disabled">—</span>

          {/* To date. */}
          <div className="relative flex items-center">
            <CalendarDays size={12} className="absolute left-2.5 text-text-disabled pointer-events-none" />
            <input
              type="date"
              value={toInput}
              onChange={e => setToInput(e.target.value)}
              title={t('audit.filterTo')}
              className={`${inputCls} pl-8 [color-scheme:dark]`}
            />
          </div>

          <Button size="sm" onClick={applyFilters} className="h-8 ml-auto">
            <Search size={12} />
            {t('common.search')}
          </Button>
        </div>
      </div>

      {/* Content. */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-400">{t('common.error')}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('audit.empty')} subtitle={t('audit.emptySubtitle')} />
      ) : (
        <div className="space-y-1">
          {/* Table with floating rows; border-spacing creates gaps between rows. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>

              {/* Column widths. */}
              <colgroup>
                <col />
                <col style={{ width: '11rem' }} />
                <col style={{ width: '13rem' }} />
                <col style={{ width: '7.5rem' }} />
              </colgroup>

              {/* Compact 32px uppercase header using disabled text color. */}
              <thead>
                <tr>
                  {[t('audit.actor'), t('audit.action'), t('audit.resource'), t('common.date')].map((h, i) => (
                    <th
                      key={h}
                      className={`py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-disabled ${i === 0 ? 'pl-4 pr-3' : 'px-3'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Floating rows. */}
              <tbody>
                {logs.map(log => {
                  const actorDisplay = log.actorName || log.actorEmail
                  return (
                    <tr key={log.id} className="group">
                      {/* Actor column: left-rounded first cell. */}
                      <td className="bg-background-paper group-hover:bg-grey-50/60 transition-colors rounded-l-xl pl-4 pr-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <ActorAvatar name={actorDisplay} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate leading-tight">
                              {log.actorName || log.actorEmail}
                            </p>
                            {log.actorName && (
                              <p className="text-xs text-text-secondary truncate leading-tight mt-0.5">{log.actorEmail}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Action. */}
                      <td className="bg-background-paper group-hover:bg-grey-50/60 transition-colors px-3 py-3">
                        <ActionBadge action={log.action} metadata={log.metadata} />
                      </td>

                      {/* Resource. */}
                      <td className="bg-background-paper group-hover:bg-grey-50/60 transition-colors px-3 py-3">
                        {log.resourceType && (
                          <p className="text-[11px] text-text-disabled leading-tight">
                            {t(`audit.resourceTypes.${log.resourceType}`, { defaultValue: log.resourceType })}
                          </p>
                        )}
                        {log.resourceName && (
                          <p className="text-xs font-medium text-text-primary truncate max-w-[90px] leading-tight mt-0.5">{log.resourceName}</p>
                        )}
                        {!log.resourceType && !log.resourceName && (
                          <span className="text-xs text-text-disabled">—</span>
                        )}
                      </td>

                      {/* Date; last cell has right rounding. */}
                      <td className="bg-background-paper group-hover:bg-grey-50/60 transition-colors rounded-r-xl px-3 py-3">
                        <span className="text-xs text-text-secondary whitespace-nowrap">{formatDate(log.createdAt)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer: total and numbered pagination. */}
          <div className="flex items-center justify-between pt-1 px-1">
            <span className="text-xs text-text-disabled">
              {t('audit.page', { page })}
            </span>
            <NumericPagination
              page={page}
              hasMore={hasMore}
              onPage={p => { setPage(p); window.scrollTo({ top: 0 }) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
