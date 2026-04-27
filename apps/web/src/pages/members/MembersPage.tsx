import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  UserPlus, Trash2, Mail, ChevronDown, Check, Shield,
  Eye, Code2, ShieldCheck, Users, ShieldAlert,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { z } from 'zod'
import { membersApi } from '@/api/members'
import { customRolesApi, type CustomRole } from '@/api/customRoles'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { RoleBadge } from '@/components/shared/RoleBadge'
import type { Member } from '@/api/members'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/spinner'
import type { OrgRole } from '@zoneploy/types'

// Role selector modal

type AssignableRole = Exclude<OrgRole, 'owner'>

interface RoleChoice {
  role: AssignableRole
  label: string
  desc?: string
  customRoleId?: string
  customRoleName?: string
}

function builtInRoleChoices(t: TFunction): RoleChoice[] {
  return [
    { role: 'admin', label: t('members.roles.admin'), desc: t('members.roles.adminDesc') },
    { role: 'member', label: t('members.roles.member'), desc: t('members.roles.memberDesc') },
    { role: 'viewer', label: t('members.roles.viewer'), desc: t('members.roles.viewerDesc') },
  ]
}

function customRoleChoices(customRoles: CustomRole[]): RoleChoice[] {
  return customRoles.map(role => ({
    role: 'custom',
    label: role.name,
    desc: role.description ?? undefined,
    customRoleId: role.id,
    customRoleName: role.name,
  }))
}

function roleDisplayName(t: TFunction, role: OrgRole, customRoleName?: string | null) {
  if (role === 'custom') return customRoleName || t('members.roles.custom')
  return t(`members.roles.${role}`, { defaultValue: role })
}

function RoleSelector({
  value, customRoleId, customRoles, customRolesFeatureEnabled, onSelect,
}: {
  value: AssignableRole
  customRoleId: string
  customRoles: CustomRole[]
  customRolesFeatureEnabled: boolean
  onSelect: (choice: RoleChoice) => void
}) {
  const { t } = useTranslation()
  const opts = [...builtInRoleChoices(t), ...customRoleChoices(customRoles)]

  return (
    <div className="space-y-2">
      {opts.map(opt => (
        <button
          key={opt.customRoleId ?? opt.role}
          type="button"
          onClick={() => onSelect(opt)}
          className={cn(
            'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
            value === opt.role && (opt.role !== 'custom' || opt.customRoleId === customRoleId)
              ? 'border-primary bg-primary/10'
              : 'border-grey-100 hover:border-grey-200 bg-background-paper',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">{opt.label}</span>
            {value === opt.role && (opt.role !== 'custom' || opt.customRoleId === customRoleId) && (
              <span className="h-2 w-2 rounded-full bg-primary" />
            )}
          </div>
          {opt.desc && <p className="text-xs text-text-secondary mt-0.5">{opt.desc}</p>}
          {opt.role === 'custom' && (
            <p className="text-[10px] uppercase tracking-wide text-text-disabled mt-1">
              {t('members.roles.custom')}
            </p>
          )}
        </button>
      ))}

      {customRolesFeatureEnabled && customRoles.length === 0 && (
        <p className="rounded-lg border border-grey-100 bg-grey-50 px-3 py-2 text-xs text-text-secondary">
          {t('members.noCustomRoles')}
        </p>
      )}
    </div>
  )
}

// Invitation modal

const InviteSchema = z.object({
  email: z.string().email('Email inválido'),
  role: z.enum(['admin', 'member', 'viewer', 'custom']),
})
type InviteInput = z.infer<typeof InviteSchema>

function InviteModal({
  orgId,
  customRoles,
  canManageRoles,
  customRolesFeatureEnabled,
  onClose,
}: {
  orgId: string
  customRoles: CustomRole[]
  canManageRoles: boolean
  customRolesFeatureEnabled: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [customRoleId, setCustomRoleId] = useState('')
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<InviteInput>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { role: canManageRoles ? 'member' : 'viewer' },
  })

  const selectedRole = watch('role')

  const invite = useMutation({
    mutationFn: (data: InviteInput) =>
      membersApi.invite(orgId, {
        email: data.email,
        role: data.role as Exclude<OrgRole, 'owner'>,
        ...(data.role === 'custom' && customRoleId ? { customRoleId } : {}),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invitations', orgId] }); onClose() },
  })

  const isCustomWithoutRole = selectedRole === 'custom' && !customRoleId

  return (
    <form onSubmit={handleSubmit(d => invite.mutate(d))} className="space-y-4">
      {invite.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {(invite.error as Error).message}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">{t('members.inviteEmail')}</Label>
        <Input id="invite-email" type="email" placeholder={t('members.inviteEmailPlaceholder')} {...register('email')} />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>{t('common.role')}</Label>
        {canManageRoles ? (
          <RoleSelector
            value={selectedRole}
            customRoleId={customRoleId}
            customRoles={customRoles}
            customRolesFeatureEnabled={customRolesFeatureEnabled}
            onSelect={choice => {
              setValue('role', choice.role)
              setCustomRoleId(choice.customRoleId ?? '')
            }}
          />
        ) : (
          <div className="rounded-lg border border-grey-100 bg-grey-50 px-3 py-2">
            <RoleBadge role="viewer" />
            <p className="mt-1 text-xs text-text-secondary">{t('members.inviteRoleLocked')}</p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={invite.isPending} disabled={isCustomWithoutRole}>
          <Mail size={14} />{t('members.sendInvite')}
        </Button>
      </div>
    </form>
  )
}

// Inline role change dropdown

function RoleDropdown({
  current,
  currentCustomRoleId,
  currentCustomRoleName,
  customRoles,
  onSelect,
  loading,
}: {
  current: OrgRole
  currentCustomRoleId: string | null
  currentCustomRoleName: string | null
  customRoles: CustomRole[]
  onSelect: (choice: RoleChoice) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const options = [...builtInRoleChoices(t), ...customRoleChoices(customRoles)]

  useEffect(() => {
    if (!open) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    const h = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (current === 'owner') return <RoleBadge role="owner" />

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="flex items-center gap-1 group"
      >
        <RoleBadge role={current} label={roleDisplayName(t, current, currentCustomRoleName)} />
        <ChevronDown size={12} className={cn('text-text-disabled group-hover:text-text-secondary transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          className="fixed bg-background-paper border border-grey-100 rounded-xl shadow-darker-md z-50 py-1 min-w-[11rem]"
          style={{ top: pos.top, right: pos.right }}
        >
          {options.map(option => {
            const selected = option.role === current && (option.role !== 'custom' || option.customRoleId === currentCustomRoleId)
            return (
            <button
              key={option.customRoleId ?? option.role}
              onClick={() => { onSelect(option); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-text-primary hover:bg-grey-50 transition-colors"
            >
              <span>{option.label}</span>
              {selected && <Check size={12} className="text-primary" />}
            </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

// Subsection separator

function SectionDivider({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-disabled whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-grey-100" />
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// Member avatar with hashed initial color

const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-purple-500/15 text-purple-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-pink-500/15 text-pink-400',
]

function MemberAvatar({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('')
  const colorIdx = name.charCodeAt(0) % AVATAR_COLORS.length
  return (
    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold select-none ${AVATAR_COLORS[colorIdx]}`}>
      {initials || '?'}
    </div>
  )
}

// Section 1: member list

function MembersSection({ orgId, currentUserId, currentRole, customRoles }: {
  orgId: string
  currentUserId: string
  currentRole: OrgRole
  customRoles: CustomRole[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [pendingRole, setPendingRole] = useState<{
    userId: string
    name: string
    newRole: AssignableRole
    customRoleId?: string
    customRoleName?: string
    roleLabel: string
  } | null>(null)
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; name: string } | null>(null)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersApi.list(orgId),
    enabled: !!orgId,
  })

  const { can } = usePermissions()
  const canManage = can('members:manage')

  const changeRole = useMutation({
    mutationFn: ({ userId, role, customRoleId }: { userId: string; role: AssignableRole; customRoleId?: string; customRoleName?: string }) =>
      membersApi.changeRole(orgId, userId, { role, customRoleId }),
    onSuccess: (_, { userId, role, customRoleId, customRoleName }) => {
      queryClient.setQueryData<Member[]>(['members', orgId], old =>
        old?.map(m => m.userId === userId ? {
          ...m,
          role,
          customRoleId: role === 'custom' ? customRoleId ?? null : null,
          customRoleName: role === 'custom' ? customRoleName ?? null : null,
        } : m) ?? [],
      )
    },
  })

  const remove = useMutation({
    mutationFn: (userId: string) => membersApi.remove(orgId, userId),
    onSuccess: (_, userId) => {
      queryClient.setQueryData<Member[]>(['members', orgId], old =>
        old?.filter(m => m.userId !== userId) ?? [],
      )
    },
  })

  return (
    <Card className="p-0 overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Users size={16} className="text-primary" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('members.title')}</p>
            <p className="text-xs text-text-secondary">{t('members.count', { count: members.length })}</p>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="border-t border-border">
        {isLoading ? (
          <LoadingState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-disabled">{t('common.user')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled">{t('common.role')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled hidden sm:table-cell">{t('members.joinedAt')}</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map(member => {
                  const isSelf = member.userId === currentUserId
                  const canEdit =
                    canManage
                    && !isSelf
                    && member.role !== 'owner'
                    && !(currentRole === 'admin' && member.role === 'admin')

                  return (
                    <tr key={member.id} className="hover:bg-grey-50/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <MemberAvatar name={member.userFullName} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-text-primary truncate">{member.userFullName}</span>
                              {isSelf && (
                                <span className="text-[10px] text-text-secondary border border-grey-200 rounded px-1 py-px shrink-0 leading-none">
                                  {t('members.you')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-px">
                              <p className="text-xs text-text-secondary truncate">{member.userEmail}</p>
                              {member.twoFactorEnabled ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-success border border-success/30 bg-success/10 rounded px-1 py-px shrink-0 leading-none">
                                  <ShieldAlert size={9} strokeWidth={2.5} />2FA
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-text-disabled border border-grey-200 rounded px-1 py-px shrink-0 leading-none">
                                  <ShieldAlert size={9} strokeWidth={2.5} />2FA
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {canEdit ? (
                          <RoleDropdown
                            current={member.role}
                            currentCustomRoleId={member.customRoleId}
                            currentCustomRoleName={member.customRoleName}
                            customRoles={customRoles}
                            onSelect={choice => setPendingRole({
                              userId: member.userId,
                              name: member.userFullName,
                              newRole: choice.role,
                              customRoleId: choice.customRoleId,
                              customRoleName: choice.customRoleName,
                              roleLabel: choice.label,
                            })}
                            loading={changeRole.isPending && changeRole.variables?.userId === member.userId}
                          />
                        ) : (
                          <RoleBadge role={member.role} label={roleDisplayName(t, member.role, member.customRoleName)} />
                        )}
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <span className="text-sm text-text-secondary">
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {canEdit && (
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setPendingRemove({ userId: member.userId, name: member.userFullName })}
                            loading={remove.isPending && remove.variables === member.userId}
                            title={t('members.remove')}
                            className="h-7 w-7 text-text-disabled hover:text-error"
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingRole && (
        <ConfirmDialog
          title={t('members.confirmRoleTitle')}
          message={t('members.confirmRoleMsg', {
            name: pendingRole.name,
            role: pendingRole.roleLabel,
          })}
          confirmLabel={t('members.changeRole')}
          onConfirm={() => {
            changeRole.mutate({
              userId: pendingRole.userId,
              role: pendingRole.newRole,
              customRoleId: pendingRole.customRoleId,
              customRoleName: pendingRole.customRoleName,
            })
            setPendingRole(null)
          }}
          onCancel={() => setPendingRole(null)}
          loading={changeRole.isPending}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={t('members.confirmRemoveTitle')}
          message={t('members.confirmRemoveMsg', { name: pendingRemove.name })}
          confirmLabel={t('members.remove')}
          onConfirm={() => {
            remove.mutate(pendingRemove.userId)
            setPendingRemove(null)
          }}
          onCancel={() => setPendingRemove(null)}
          loading={remove.isPending}
          danger
        />
      )}
    </Card>
  )
}

// Section 2: invitations

function InvitationsSection({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ['invitations', orgId],
    queryFn: () => membersApi.listInvitations(orgId),
    enabled: !!orgId,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => membersApi.revokeInvitation(orgId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations', orgId] }),
  })

  return (
    <Card className="p-0 overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
            <Mail size={16} className="text-warning" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('members.invitationsTitle')}</p>
            <p className="text-xs text-text-secondary">{t('members.invitationsSubtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="border-t border-border">
        {isLoading ? (
          <LoadingState />
        ) : invitations.length === 0 ? (
          <div className="py-8">
            <EmptyState icon={Mail} title={t('members.inviteEmptyTitle')} subtitle={t('members.inviteEmptySubtitle')} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-disabled">{t('common.email')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled">{t('common.role')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled hidden sm:table-cell">{t('common.date')}</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitations.map(inv => (
                  <tr key={inv.id} className="hover:bg-grey-50/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-grey-100 flex items-center justify-center shrink-0">
                          <Mail size={13} className="text-text-secondary" strokeWidth={1.6} />
                        </div>
                        <span className="text-sm font-medium text-text-primary truncate">{inv.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <RoleBadge role={inv.role} label={roleDisplayName(t, inv.role, inv.customRoleName)} />
                    </td>
                    <td className="px-4 py-3.5 hidden sm:table-cell">
                      <span className="text-xs text-text-secondary whitespace-nowrap">
                        {t('members.expires', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => revoke.mutate(inv.id)}
                        loading={revoke.isPending && revoke.variables === inv.id}
                        title={t('members.revoke')}
                        className="h-7 w-7 text-text-disabled hover:text-error"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

// Section 3: role management

const ROLE_DEFS: { role: Exclude<OrgRole, 'custom'>; icon: React.ElementType; color: string; bg: string }[] = [
  { role: 'owner',   icon: ShieldCheck, color: 'text-amber-500',      bg: 'bg-amber-500/10' },
  { role: 'admin',   icon: Shield,      color: 'text-primary',        bg: 'bg-primary/10' },
  { role: 'member',  icon: Code2,       color: 'text-violet-500',     bg: 'bg-violet-500/10' },
  { role: 'viewer',  icon: Eye,         color: 'text-text-secondary', bg: 'bg-grey-100' },
]

const ROLE_PERMS: Record<Exclude<OrgRole, 'custom'>, string[]> = {
  owner:   ['members.perms.manageOrg', 'members.perms.manageMembers', 'members.perms.manageServers', 'members.perms.manageContainers', 'members.perms.viewAll'],
  admin:   ['members.perms.manageMembers', 'members.perms.manageServers', 'members.perms.manageContainers', 'members.perms.viewAll'],
  member:  ['members.perms.manageContainers', 'members.perms.viewAll'],
  viewer:  ['members.perms.viewAll'],
}

function RolesSection({ customRoles }: { customRoles: CustomRole[] }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1" style={{ gridAutoRows: 'auto' }}>
      {ROLE_DEFS.map(({ role, icon: Icon, color, bg }) => (
        <div key={role} className="bg-background-paper rounded-xl px-4 py-4 space-y-3">
          {/* Icon and name. */}
          <div className="flex items-center gap-2.5">
            <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', bg)}>
              <Icon size={16} className={color} strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary capitalize">{t(`members.roles.${role}` as any, { defaultValue: role })}</p>
              <p className="text-[11px] text-text-secondary">{t(`members.roles.${role}Desc` as any, { defaultValue: '' })}</p>
            </div>
          </div>

          {/* Permissions. */}
          <ul className="space-y-1.5">
            {ROLE_PERMS[role].map(permKey => (
              <li key={permKey} className="flex items-center gap-2 text-xs text-text-secondary">
                <Check size={11} className="text-success shrink-0" strokeWidth={2.5} />
                {t(permKey, { defaultValue: permKey })}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {customRoles.map(role => (
        <div key={role.id} className="bg-background-paper rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-primary/10">
              <Shield size={16} className="text-primary" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{role.name}</p>
              <p className="text-[11px] text-text-secondary">{t('members.roles.custom')}</p>
            </div>
          </div>

          {role.permissions.length === 0 ? (
            <p className="text-xs text-text-secondary">{t('members.noPermissions')}</p>
          ) : (
            <ul className="space-y-1.5">
              {role.permissions.slice(0, 6).map(permission => (
                <li key={permission} className="flex items-center gap-2 text-xs text-text-secondary">
                  <Check size={11} className="text-success shrink-0" strokeWidth={2.5} />
                  {t(`customRoles.perms.${permission}` as any, { defaultValue: permission })}
                </li>
              ))}
              {role.permissions.length > 6 && (
                <li className="text-xs text-text-disabled">
                  {t('members.morePermissions', { count: role.permissions.length - 6 })}
                </li>
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

// Main page

export function MembersPage() {
  const { t } = useTranslation()
  const [showInvite, setShowInvite] = useState(false)
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const currentRole = (session?.org?.role ?? 'viewer') as OrgRole
  const { can } = usePermissions()
  const canInvite = can('members:invite')
  const canManage = can('members:manage')

  const canUseCustomRoles = canManage

  const { data: customRoles = [] } = useQuery({
    queryKey: ['custom-roles', orgId],
    queryFn: () => customRolesApi.list(orgId),
    enabled: !!orgId && canUseCustomRoles,
  })

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('members.title')}
        subtitle={t('members.subtitle')}
        action={canInvite && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus size={14} />{t('members.addInvite')}
          </Button>
        )}
      />

      {/* 1. Member list. */}
      <MembersSection
        orgId={orgId}
        currentUserId={session?.user?.id ?? ''}
        currentRole={currentRole}
        customRoles={customRoles}
      />

      {/* 2. Invitations for admins and owners. */}
      {canInvite && (
        <InvitationsSection orgId={orgId} />
      )}

      {canManage && (
        <>
          <SectionDivider label={t('members.rolesTitle')} />
          <RolesSection customRoles={customRoles} />
        </>
      )}

      {/* Modal */}
      <Dialog
        open={showInvite}
        onClose={() => setShowInvite(false)}
        title={t('members.inviteDialogTitle')}
        description={t('members.inviteDialogSubtitle')}
      >
        <InviteModal
          orgId={orgId}
          customRoles={customRoles}
          canManageRoles={canManage}
          customRolesFeatureEnabled={canUseCustomRoles}
          onClose={() => setShowInvite(false)}
        />
      </Dialog>
    </div>
  )
}
