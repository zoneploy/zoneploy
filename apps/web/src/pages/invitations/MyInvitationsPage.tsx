import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Mail } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { authApi } from '@/api/auth'
import { invitationsApi } from '@/api/members'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingState } from '@/components/ui/spinner'
import type { OrgRole } from '@zoneploy/types'

// Role badge

const ROLE_COLORS: Record<string, string> = {
  owner:   'bg-primary/10 text-primary border-primary/20',
  admin:   'bg-warning/10 text-warning border-warning/20',
  member:  'bg-success/10 text-success border-success/20',
  viewer:  'bg-grey-50 text-text-secondary border-grey-200',
  custom:  'bg-grey-50 text-text-secondary border-grey-200',
}

// Page

export function MyInvitationsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const accessToken = useAuthStore(s => s.accessToken)
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)

  const [acceptingToken, setAcceptingToken] = useState<string | null>(null)

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: authApi.pendingInvitations,
  })

  const accept = useMutation({
    mutationFn: (token: string) => {
      setAcceptingToken(token)
      return invitationsApi.accept(token)
    },
    onSuccess: (result) => {
      // Update session with the new organization.
      const updated = {
        ...session!,
        org: {
          id: result.orgId,
          name: result.orgName,
          slug: result.orgSlug,
          logoUrl: null as string | null,
          role: result.role as OrgRole,
          customRoleId: result.customRoleId,
          permissions: result.permissions,
          require2fa: false,
        },
      }
      setSession(accessToken!, updated)
      queryClient.clear()
      navigate('/projects', { replace: true })
    },
    onSettled: () => setAcceptingToken(null),
  })

  return (
    <div className="w-full space-y-4">
      <PageHeader title={t('invitations.myTitle')} subtitle={t('invitations.mySubtitle')} />

      {/* Invitation list. */}
      {isLoading ? (
        <LoadingState />
      ) : invitations.length === 0 ? (
        <Card>
          <EmptyState
            icon={Mail}
            title={t('invitations.emptyTitle')}
            subtitle={t('invitations.emptySubtitle')}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {invitations.map(inv => (
            <Card key={inv.id} className="p-0">
              <CardContent className="flex items-center gap-4 px-5 py-4">
                {/* Icono */}
                <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <UserPlus size={18} className="text-primary" strokeWidth={1.6} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{inv.orgName}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t('invitations.invitedBy', { name: inv.invitedByName })}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[inv.role] ?? ROLE_COLORS['viewer']}`}>
                      {inv.role === 'custom' ? inv.customRoleName || t('members.roles.custom') : t(`members.roles.${inv.role}`, { defaultValue: inv.role })}
                    </span>
                    <span className="text-[10px] text-text-disabled">
                      {t('invitations.expiresAt', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                    </span>
                  </div>
                </div>

                {/* Action. */}
                <Button
                  size="sm"
                  loading={acceptingToken === inv.token}
                  disabled={acceptingToken !== null && acceptingToken !== inv.token}
                  onClick={() => accept.mutate(inv.token)}
                >
                  {t('invitation.accept')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </div>
  )
}
