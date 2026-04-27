import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Box, Users, Settings,
  ChevronRight, ChevronsUpDown, Building2, Bell,
  LogOut, User, Shield, Check, Sun, Moon, MessageSquare, BookOpen,
  Rocket, X, FolderOpen, ClipboardList, Mail, UserPlus, BellOff, Package,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { invitationsApi } from '@/api/members'
import { notificationsApi } from '@/api/notifications'
import { serversApi } from '@/api/servers'
import { containersApi } from '@/api/containers'
import { projectsApi } from '@/api/projects'
import { useLogout } from '@/hooks/useAuth'
import { useTheme } from '@/contexts/ThemeContext'
import { renderNotification, formatRelativeTime } from '@/lib/notificationRenderers'
import type { OrgRole, Permission } from '@zoneploy/types'
import { usePermissions } from '@/hooks/usePermissions'
import { OrgLogo } from '@/components/organization/OrgLogo'
import { DOCS_URL } from '@/lib/external-links'

// Languages

const LANGUAGES = [
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

// Nav items

interface NavItemDef {
  id: string
  label: string
  icon: React.ElementType
  to?: string
  children?: NavItemDef[]
  permission?: Permission
}

const NAV_ITEMS: NavItemDef[] = [
  { id: 'projects',   label: 'nav.projects',   icon: FolderOpen,      to: '/projects' },
  { id: 'deployments', label: 'nav.deployments', icon: Box,            to: '/deployments' },
  { id: 'servers',    label: 'nav.servers',    icon: Server,          to: '/server' },
  {
    id: 'organization',
    label: 'nav.organization',
    icon: Building2,
    children: [
      { id: 'members',      label: 'nav.members',      icon: Users,          to: '/members',        permission: 'members:read' },
      { id: 'custom-roles', label: 'nav.customRoles',  icon: Shield,         to: '/custom-roles',   permission: 'members:manage' },
      { id: 'audit',        label: 'nav.audit',        icon: ClipboardList,  to: '/audit',          permission: 'audit:read' },
      { id: 'addons',       label: 'nav.addons',       icon: Package,        to: '/addons' },
      { id: 'settings',     label: 'nav.settings',     icon: Settings,       to: '/settings',       permission: 'organization:manage' },
    ],
  },
]


// Pending invitations shown only when no org is selected

function PendingInvitationsNavItem({ collapsed, onClose }: { collapsed: boolean; onClose?: () => void }) {
  const { t } = useTranslation()
  const { data: invitations = [] } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: authApi.pendingInvitations,
    staleTime: 0,
  })
  const count = invitations.length

  return (
    <NavLink
      to="/invitations"
      onClick={onClose}
      title={collapsed ? t('nav.invitations') : undefined}
      className={({ isActive }) => cn(
        'group flex w-full items-center gap-2.5 rounded-sm py-1 text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-1' : 'px-2',
        isActive
          ? 'bg-grey-50 text-primary'
          : 'text-text-secondary hover:bg-grey-50 hover:text-text-primary',
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors',
            isActive ? 'bg-primary/10 text-primary' : 'text-text-secondary group-hover:text-text-primary',
          )}>
            <Mail size={17} strokeWidth={1.6} />
          </span>
          {!collapsed && (
            <>
              <span className="flex-1">{t('nav.invitations')}</span>
              {count > 0 && (
                <span className="h-5 min-w-[20px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                  {count}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  )
}

// Nav icon

function NavIcon({ icon: Icon, active }: { icon: React.ElementType; active: boolean }) {
  return (
    <span className={cn(
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors',
      active ? 'bg-primary/10 text-primary' : 'text-text-secondary group-hover:text-text-primary',
    )}>
      <Icon size={17} strokeWidth={1.6} />
    </span>
  )
}

// Simple item

function LeafItem({
  item, collapsed, indent = 0, onClose,
}: {
  item: NavItemDef
  collapsed: boolean
  indent?: number
  onClose?: () => void
}) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={item.to!}
      end={indent === 0}
      onClick={onClose}
      title={collapsed ? t(item.label) : undefined}
      className={({ isActive }) => cn(
        'group flex w-full items-center gap-2.5 rounded-sm py-1 text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-1' : 'px-2',
        indent > 0 && !collapsed && 'pl-4',
        isActive
          ? 'bg-grey-50 text-primary'
          : 'text-text-secondary hover:bg-grey-50 hover:text-text-primary',
      )}
    >
      {({ isActive }) => (
        <>
          {indent === 0 ? (
            <NavIcon icon={item.icon} active={isActive} />
          ) : !collapsed ? (
            <span className={cn(
              'ms-1 flex h-6 w-6 shrink-0 items-center justify-center',
              isActive ? 'text-primary' : 'text-text-secondary',
            )}>
              <item.icon size={14} strokeWidth={1.6} />
            </span>
          ) : null}
          {!collapsed && <span>{t(item.label)}</span>}
        </>
      )}
    </NavLink>
  )
}

function ExternalLeafItem({
  label,
  icon: Icon,
  href,
  collapsed,
  onClose,
}: {
  label: string
  icon: React.ElementType
  href: string
  collapsed: boolean
  onClose?: () => void
}) {
  const { t } = useTranslation()
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClose}
      title={collapsed ? t(label) : undefined}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-sm py-1 text-sm font-medium text-text-secondary transition-colors hover:bg-grey-50 hover:text-text-primary',
        collapsed ? 'justify-center px-1' : 'px-2',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors group-hover:text-text-primary">
        <Icon size={17} strokeWidth={1.6} />
      </span>
      {!collapsed && <span>{t(label)}</span>}
    </a>
  )
}

// Accordion item

function AccordionItem({
  item, collapsed, onClose,
}: {
  item: NavItemDef
  collapsed: boolean
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const { can } = usePermissions()
  const visibleChildren = item.children?.filter(c => !c.permission || can(c.permission)) ?? []
  const hasActiveChild = visibleChildren.some(c => c.to && location.pathname.startsWith(c.to))
  const [open, setOpen] = useState(hasActiveChild)

  useEffect(() => { if (hasActiveChild) setOpen(true) }, [hasActiveChild])

  if (collapsed) {
    return (
      <button
        title={t(item.label)}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'group flex w-full justify-center rounded-sm p-1 transition-colors',
          (open || hasActiveChild)
            ? 'bg-grey-50 text-primary'
            : 'text-text-secondary hover:bg-grey-50 hover:text-text-primary',
        )}
      >
        <NavIcon icon={item.icon} active={open || hasActiveChild} />
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-sm px-2 py-1 text-sm font-medium transition-colors',
          (open || hasActiveChild)
            ? 'bg-grey-50 text-primary'
            : 'text-text-secondary hover:bg-grey-50 hover:text-text-primary',
        )}
      >
        <NavIcon icon={item.icon} active={open || hasActiveChild} />
        <span className="flex-1 text-left">{t(item.label)}</span>
        <ChevronRight
          size={13}
          className={cn('shrink-0 transition-transform text-text-secondary', open && 'rotate-90')}
        />
      </button>

      {open && (
        <div className="mt-0.5 flex flex-col gap-0.5 pb-0.5">
          {visibleChildren.map(child => (
            <LeafItem key={child.id} item={child} collapsed={false} indent={1} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

// Notification panel shown to the right of the sidebar

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const accessToken = useAuthStore(s => s.accessToken)
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)

  const { data: notifData, isLoading: notifLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    staleTime: 0,
    refetchInterval: 60_000,
  })

  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: authApi.pendingInvitations,
    refetchInterval: 30_000,
    staleTime: 0,
  })

  const notifications = notifData?.items ?? []
  const unreadCount = notifData?.unread ?? 0
  const inviteCount = pendingInvitations.length

  // Open invitations when pending; otherwise open notifications.
  const [tab, setTab] = useState<'notifications' | 'invitations'>(
    () => pendingInvitations.length > 0 ? 'invitations' : 'notifications'
  )

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllRead = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const accept = useMutation({
    mutationFn: (token: string) => invitationsApi.accept(token),
    onSuccess: (result) => {
      const updated = {
        ...session!,
        org: {
          id: result.orgId,
          name: result.orgName,
          slug: result.orgSlug,
          logoUrl: null as string | null,
          require2fa: result.orgRequire2fa ?? false,
          role: result.role as OrgRole,
          customRoleId: result.customRoleId,
          permissions: result.permissions,
        },
      }
      setSession(accessToken!, updated)
      queryClient.clear()
      onClose()
      navigate('/projects', { replace: true })
    },
  })

  const decline = useMutation({
    mutationFn: (token: string) => invitationsApi.decline(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-invitations'] }),
  })

  const handleNotifClick = (id: string, link: string | null | undefined, isUnread: boolean) => {
    if (isUnread) markRead.mutate(id)
    if (link) { navigate(link); onClose() }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 md:hidden" style={{ zIndex: 9998 }} onClick={onClose} />
      <div data-sidebar-panel="notifications" className="fixed top-14 left-2 right-2 md:left-[330px] md:right-auto md:w-80 bg-background-paper rounded-xl shadow-darker-md border border-grey-100 overflow-hidden" style={{ zIndex: 9999 }}>
      {/* Tabs */}
      <div className="flex border-b border-grey-100">
        <button
          onClick={() => setTab('notifications')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors',
            tab === 'notifications'
              ? 'text-text-primary border-b-2 border-primary -mb-px'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {t('sidebar.notifications')}
          {unreadCount > 0 && (
            <span className="h-4 min-w-[16px] px-1 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('invitations')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors',
            tab === 'invitations'
              ? 'text-text-primary border-b-2 border-primary -mb-px'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {t('sidebar.invitations')}
          {inviteCount > 0 && (
            <span className="h-4 min-w-[16px] px-1 rounded-full bg-error text-white text-[9px] font-bold flex items-center justify-center">
              {inviteCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab: Notificaciones */}
      {tab === 'notifications' && (
        <>
          {unreadCount > 0 && (
            <div className="flex justify-end px-4 py-1.5 border-b border-grey-100/60">
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-[11px] text-primary hover:underline font-medium disabled:opacity-50"
              >
                {t('sidebar.markAllRead')}
              </button>
            </div>
          )}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-grey-100/50">
            {notifLoading ? (
              <div className="py-8 text-center text-xs text-text-disabled">{t('common.loading')}</div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <BellOff size={28} className="text-text-disabled mb-2" strokeWidth={1.2} />
                <p className="text-sm text-text-secondary">{t('sidebar.noNotifications')}</p>
              </div>
            ) : (
              notifications.map(notif => {
                const isUnread = !notif.readAt
                const display = renderNotification(notif.type as any, notif.data, notif.link, t)
                const Icon = display.icon
                return (
                  <div
                    key={notif.id}
                    onClick={() => handleNotifClick(notif.id, notif.link, isUnread)}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 transition-colors',
                      notif.link ? 'cursor-pointer hover:bg-grey-50' : 'cursor-default',
                      isUnread && 'bg-primary/[0.03]',
                    )}
                  >
                    <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5', display.iconBg)}>
                      <Icon size={16} className={display.iconColor} strokeWidth={1.6} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-text-primary leading-snug">{display.title}</p>
                        {isUnread && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5 leading-relaxed line-clamp-2">{display.body}</p>
                      <p className="text-[10px] text-text-disabled mt-1">{formatRelativeTime(notif.createdAt, t)}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="px-4 py-2 border-t border-grey-100">
            <button
              onClick={() => { navigate('/notifications'); onClose() }}
              className="w-full text-xs text-center text-text-secondary hover:text-primary transition-colors py-0.5 font-medium"
            >
              {t('sidebar.viewAll')}
            </button>
          </div>
        </>
      )}

      {/* Invitations tab. */}
      {tab === 'invitations' && (
        <>
        <div className="max-h-[400px] overflow-y-auto">
          {pendingInvitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <Mail size={28} className="text-text-disabled mb-2" strokeWidth={1.2} />
              <p className="text-sm text-text-secondary">{t('sidebar.noInvitations')}</p>
            </div>
          ) : (
            pendingInvitations.map(inv => (
              <div key={inv.id} className="flex items-start gap-3 px-4 py-3.5 border-b border-grey-100/60 last:border-0">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <UserPlus size={15} className="text-primary" strokeWidth={1.6} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary leading-snug truncate">{inv.orgName}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t('dashboard.invitedBy', { name: inv.invitedByName })}
                    {' · '}
                    <span>{inv.role === 'custom' ? inv.customRoleName || t('members.roles.custom') : t(`members.roles.${inv.role}`, { defaultValue: inv.role })}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <button
                      onClick={() => accept.mutate(inv.token)}
                      disabled={accept.isPending || decline.isPending}
                      className="flex-1 rounded-lg bg-primary text-white text-xs font-semibold py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {t('invitation.accept')}
                    </button>
                    <button
                      onClick={() => decline.mutate(inv.token)}
                      disabled={accept.isPending || decline.isPending}
                      className="flex-1 rounded-lg border border-grey-200 text-text-secondary text-xs font-semibold py-1.5 hover:bg-grey-50 transition-colors disabled:opacity-50"
                    >
                      {t('invitation.decline')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-grey-100">
          <button
            onClick={() => { navigate('/invitations'); onClose() }}
            className="w-full text-xs text-center text-text-secondary hover:text-primary transition-colors py-0.5 font-medium"
          >
            {t('sidebar.viewAllInvitations')}
          </button>
        </div>
        </>
      )}
    </div>
    </>,
    document.body,
  )
}

// User menu

function UserMenu({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const logout = useLogout()
  const session = useAuthStore(s => s.session)
  const { mode, toggleMode } = useTheme()
  const [langOpen, setLangOpen] = useState(false)

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('i18nextLng', code)
    setLangOpen(false)
  }

  const currentLang = LANGUAGES.find(l => i18n.language?.startsWith(l.code)) ?? LANGUAGES[0]!

  const initials = session?.user?.fullName
    ? session.user.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-paper rounded-xl shadow-darker-md border border-grey-100 z-50 overflow-hidden">
      {/* Header with avatar. */}
      <div className="flex items-center gap-3 px-3 py-3 border-b border-grey-100">
        <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center text-primary text-sm font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{session?.user?.fullName}</p>
          <p className="text-xs text-text-secondary truncate">{session?.user?.email}</p>
        </div>
      </div>

      {/* Navigation links. */}
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <UserMenuItem icon={User} label={t('topbar.profile')} to="/profile" onClick={() => { navigate('/profile'); onClose() }} />
        <UserMenuItem icon={Shield} label={t('topbar.security')} to="/security" onClick={() => { navigate('/security'); onClose() }} />
      </div>
      <div className="h-px bg-grey-100" />

      {/* Tema + Idioma */}
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <button
          onClick={toggleMode}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-text-primary hover:bg-grey-50 transition-colors"
        >
          <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-grey-50 text-text-secondary shrink-0">
            {mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </div>
          <span className="flex-1 text-left">{t('topbar.mode')}</span>
          <span className="text-[10px] font-medium text-text-secondary border border-grey-200 rounded-sm px-1.5 py-0.5">
            {mode === 'dark' ? t('topbar.modeDark') : t('topbar.modeLight')}
          </span>
        </button>

        <div className="relative">
          <button
            onClick={() => setLangOpen(v => !v)}
            className={cn(
              'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-text-primary hover:bg-grey-50 transition-colors',
              langOpen && 'bg-grey-50',
            )}
          >
            <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-grey-50 text-text-secondary shrink-0">
              <MessageSquare size={14} />
            </div>
            <span className="flex-1 text-left">{t('topbar.language')}</span>
            <span className="text-[10px] font-medium text-text-secondary border border-grey-200 rounded-sm px-1.5 py-0.5">
              {currentLang.flag} {currentLang.label}
            </span>
          </button>
          {langOpen && (
            <div className="absolute left-0 right-0 bottom-full mb-0.5 bg-background-paper rounded-xl border border-grey-100 shadow-darker-xs overflow-hidden z-10">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => changeLanguage(lang.code)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-grey-50 transition-colors',
                    i18n.language?.startsWith(lang.code) ? 'text-primary font-medium' : 'text-text-primary',
                  )}
                >
                  <span className="text-base">{lang.flag}</span>
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-grey-100" />

      {/* Sign out. */}
      <div className="px-2 py-1.5">
        <button
          onClick={() => { logout(); onClose() }}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/5 transition-colors"
        >
          <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive shrink-0">
            <LogOut size={14} />
          </div>
          {t('auth.logout')}
        </button>
      </div>
    </div>
  )
}

function UserMenuItem({ icon: Icon, label, onClick, to }: { icon: React.ElementType; label: string; onClick: () => void; to?: string }) {
  const isActive = !!useMatch(to ?? '__never__')
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors',
        isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-text-primary hover:bg-grey-50',
      )}
    >
      <div className={cn(
        'h-7 w-7 flex items-center justify-center rounded-lg shrink-0',
        isActive ? 'bg-primary/10 text-primary' : 'bg-grey-50 text-text-secondary',
      )}>
        <Icon size={14} />
      </div>
      {label}
    </button>
  )
}

// Getting Started widget

function GettingStartedWidget({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''

  const dismissKey = `gs-dismissed-${orgId || 'no-org'}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1')

  const { data: servers = [] } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId && !dismissed,
    staleTime: 30_000,
  })

  const { data: containers = [] } = useQuery({
    queryKey: ['containers', orgId],
    queryFn: () => containersApi.list(orgId),
    enabled: !!orgId && !dismissed,
    staleTime: 30_000,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId && !dismissed,
    staleTime: 30_000,
  })

  const runningContainer = containers.find(c => c.status === 'running')

  const steps = orgId ? [
    {
      id: 'server',
      label: t('gettingStarted.step1'),
      done: servers.length > 0,
      to: '/server',
    },
    {
      id: 'project',
      label: t('gettingStarted.step2'),
      done: projects.length > 0,
      to: '/projects',
    },
    {
      id: 'container',
      label: t('gettingStarted.step3'),
      done: containers.length > 0,
      to: '/deployments',
    },
    {
      id: 'deploy',
      label: t('gettingStarted.step4'),
      done: !!runningContainer,
      to: runningContainer ? `/containers/${runningContainer.id}` : '/deployments',
    },
  ] : [
    {
      id: 'create-org',
      label: t('gettingStarted.step0'),
      done: false,
      to: '/invitations',
    },
  ]

  const completedCount = steps.filter(s => s.done).length
  const allDone = completedCount === steps.length

  if (dismissed || allDone || collapsed) return null

  const dismiss = () => {
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  return (
    <div className="mx-2 mb-2 mt-3 rounded-xl border border-grey-100 bg-background relative">
      {/* Close button in the top-right corner. */}
      <button
        onClick={dismiss}
        title={t('gettingStarted.dismiss')}
        className="absolute top-3 right-3 text-text-disabled hover:text-text-secondary transition-colors z-10"
      >
        <X size={14} />
      </button>

      {/* Rocket icon in the top-left corner. */}
      <div className="absolute -top-4 -left-2 h-10 w-10 rounded-full bg-primary flex items-center justify-center shadow-md">
        <Rocket size={22} className="text-white" />
      </div>

      {/* Cabecera */}
      <div className="px-4 pt-8 pb-3">
        <p className="text-sm font-bold text-text-primary leading-tight pr-5">
          {t('gettingStarted.title')}
        </p>
        <p className="text-[11px] text-text-secondary mt-1 leading-relaxed pr-5">
          {t('gettingStarted.subtitle')}
        </p>
      </div>

      {/* Progreso */}
      <div className="px-4 pb-2">
        <p className="text-[11px] text-text-secondary mb-1.5">
          {t('gettingStarted.progress', { done: completedCount, total: steps.length })}
        </p>
        <div className="h-1 w-full rounded-full bg-grey-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Pasos */}
      <div className="px-4 py-2 flex flex-col gap-0.5">
        {steps.map(step => (
          <button
            key={step.id}
            onClick={() => navigate(step.to)}
            className="flex items-center gap-2.5 py-1 text-left w-full group"
          >
            {step.done ? (
              <span className="h-[18px] w-[18px] rounded-full bg-primary flex items-center justify-center shrink-0">
                <Check size={9} className="text-white" strokeWidth={3} />
              </span>
            ) : (
              <span className="h-[18px] w-[18px] rounded-full border-2 border-dashed border-grey-300 shrink-0" />
            )}
            <span className={cn(
              'text-[11px] font-medium leading-tight',
              step.done
                ? 'line-through text-text-disabled'
                : 'text-text-secondary group-hover:text-text-primary transition-colors',
            )}>
              {step.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Main sidebar

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  onMobileClose: () => void
}

export function Sidebar({ collapsed, mobileOpen, onMobileClose }: SidebarProps) {
  const session = useAuthStore(s => s.session)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const initials = session?.user?.fullName
    ? session.user.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  // Bell total badge: pending invitations plus unread notifications.
  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: authApi.pendingInvitations,
    refetchInterval: 30_000,
    staleTime: 0,
  })
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 1 }),
    refetchInterval: 60_000,
    staleTime: 0,
  })
  const bellBadgeCount = pendingInvitations.length + (notifData?.unread ?? 0)

  // Close all panels when clicking outside the sidebar and portals.
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement
      const insideSidebar = sidebarRef.current?.contains(target)
      const insidePanel = !!target.closest?.('[data-sidebar-panel]')
      if (!insideSidebar && !insidePanel) {
        setNotifOpen(false)
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <>
      {/* Mobile backdrop. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        ref={sidebarRef}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-background-paper border-r border-grey-100/60 transition-all duration-300',
          'w-[320px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-[320px]',
        )}
      >
        {/* Organization header. */}
        <div className={cn(
          'h-14 flex items-center shrink-0 border-b border-grey-100/60 relative',
          collapsed ? 'justify-center px-2' : 'px-3 gap-1',
        )}>
          {!collapsed ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-2 py-1.5 min-w-0">
                <OrgLogo
                  src={session?.org?.logoUrl}
                  alt={session?.org?.name ?? 'Zoneploy'}
                  className="h-7 w-7 shrink-0"
                />

                <span className="flex-1 text-[15px] font-semibold text-text-primary truncate">
                  {session?.org?.name ?? 'Zoneploy'}
                </span>
              </div>

              {/* Bell with badge. */}
              <button
                onClick={() => { setNotifOpen(v => !v); setUserMenuOpen(false) }}
                className={cn(
                  'relative h-8 w-8 flex items-center justify-center rounded-sm text-text-secondary hover:bg-grey-50 transition-colors shrink-0',
                  notifOpen && 'bg-grey-50 text-text-primary',
                )}
              >
                <Bell size={15} />
                {bellBadgeCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center border border-background-paper">
                    {bellBadgeCount > 9 ? '9+' : bellBadgeCount}
                  </span>
                )}
              </button>

              {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
            </>
          ) : (
            <button
              title={session?.org?.name ?? 'Zoneploy'}
              className="h-9 w-9 flex items-center justify-center"
            >
              <OrgLogo
                src={session?.org?.logoUrl}
                alt={session?.org?.name ?? 'Zoneploy'}
                className="h-7 w-7"
              />
            </button>
          )}
        </div>

        {/* Navigation. */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5">
          {session?.org ? (
            NAV_ITEMS.map(item =>
              item.children ? (
                <AccordionItem key={item.id} item={item} collapsed={collapsed} onClose={onMobileClose} />
              ) : (
                <LeafItem key={item.id} item={item} collapsed={collapsed} onClose={onMobileClose} />
              ),
            )
          ) : (
            <>
              <LeafItem
                item={{ id: 'dashboard', label: 'nav.dashboard', icon: LayoutDashboard, to: '/dashboard' }}
                collapsed={collapsed}
                onClose={onMobileClose}
              />
              <PendingInvitationsNavItem collapsed={collapsed} onClose={onMobileClose} />
            </>
          )}

          <div className="flex-1" />

          {/* Getting Started */}
          <GettingStartedWidget collapsed={collapsed} />

          {/* Docs are always visible. */}
          <div className="mt-1 pt-1 border-t border-grey-100/60">
            <ExternalLeafItem
              label="nav.docs"
              icon={BookOpen}
              href={DOCS_URL}
              collapsed={collapsed}
              onClose={onMobileClose}
            />
          </div>
        </nav>

        {/* User footer. */}
        <div className="shrink-0 border-t border-grey-100/60 p-2 relative">
          {userMenuOpen && !collapsed && (
            <UserMenu onClose={() => setUserMenuOpen(false)} />
          )}

          <button
            onClick={() => { setUserMenuOpen(v => !v); setNotifOpen(false) }}
            title={collapsed ? (session?.user?.fullName ?? '') : undefined}
            className={cn(
              'w-full flex items-center rounded-sm hover:bg-grey-50 transition-colors',
              collapsed ? 'h-10 justify-center p-1' : 'gap-2.5 px-2 py-1.5',
              userMenuOpen && 'bg-grey-50',
            )}
          >
            <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center text-primary text-sm font-bold shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-text-primary truncate leading-tight">
                    {session?.user?.fullName}
                  </p>
                  <p className="text-xs text-text-secondary truncate leading-tight">
                    {session?.user?.email}
                  </p>
                </div>
                <ChevronsUpDown size={13} className="text-text-secondary shrink-0" />
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
