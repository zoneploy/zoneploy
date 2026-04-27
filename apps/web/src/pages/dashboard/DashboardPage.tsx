import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Server, Box, Users, Building2, ArrowRight,
  Rocket, FolderOpen, AlertTriangle, Zap,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuthStore } from '@/stores/auth'
import { membersApi } from '@/api/members'
import { serversApi } from '@/api/servers'
import { containersApi } from '@/api/containers'
import { projectsApi } from '@/api/projects'
import { stacksApi } from '@/api/stacks'
import { PageHeader } from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'

// Stat card

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  onClick,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sublabel?: React.ReactNode
  onClick?: () => void
  accent?: 'default' | 'error'
}) {
  return (
    <Card
      className={cn(
        'flex items-start gap-4 transition-colors',
        onClick && 'cursor-pointer hover:border-primary/40',
        accent === 'error' && 'border-destructive/30 bg-destructive/[0.02]',
      )}
      onClick={onClick}
    >
      <div className={cn(
        'rounded-lg p-2.5',
        accent === 'error' ? 'bg-destructive/10' : 'bg-primary/10',
      )}>
        <Icon size={18} className={accent === 'error' ? 'text-destructive' : 'text-primary'} strokeWidth={1.8} />
      </div>
      <CardContent className="p-0 min-w-0">
        <p className="text-text-secondary text-sm">{label}</p>
        <p className="text-2xl font-semibold text-text-primary mt-0.5">{value}</p>
        {sublabel && <div className="mt-1">{sublabel}</div>}
      </CardContent>
    </Card>
  )
}

// No organization state

function NoOrgDashboard() {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const firstName = session?.user?.fullName?.split(' ')[0]

  return (
    <div className="space-y-6 w-full">
      <PageHeader
        title={`${t('dashboard.welcome', { name: firstName })}`}
        subtitle={t('dashboard.noOrgSubtitle')}
      />

      <Card>
        <EmptyState
          icon={Building2}
          title={t('dashboard.createOrgTitle')}
          subtitle={t('dashboard.createOrgSubtitle')}
        />
      </Card>
    </div>
  )
}
// Main dashboard with org

export function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''

  const { data: servers = [] } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: containers = [] } = useQuery({
    queryKey: ['containers', orgId],
    queryFn: () => containersApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: stacks = [] } = useQuery({
    queryKey: ['stacks', orgId],
    queryFn: () => stacksApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersApi.list(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
  })

  if (!session?.org) return <NoOrgDashboard />

  const firstName = session.user?.fullName?.split(' ')[0]
  const deploymentCount = containers.length + stacks.length

  // Container breakdown by status.
  const running  = containers.filter(c => c.status === 'running').length
  const errored  = containers.filter(c => c.status === 'error').length
  const stopped  = containers.filter(c => c.status !== 'running' && c.status !== 'error').length
  const errorContainers = containers.filter(c => c.status === 'error')

  // Guided next step.
  const hasServers    = servers.length > 0
  const hasProjects   = projects.length > 0
  const hasContainers = containers.length > 0
  const hasRunning    = running > 0

  type Step = 'servers' | 'projects' | 'containers' | 'deploy' | null
  const nextStep: Step = !hasServers    ? 'servers'
    : !hasProjects   ? 'projects'
    : !hasContainers ? 'containers'
    : !hasRunning    ? 'deploy'
    : null

  const stepConfig = {
    servers: {
      icon: Server,
      title: t('dashboard.nextStepServers'),
      subtitle: t('dashboard.nextStepServersSubtitle'),
      action: () => navigate('/server'),
      label: t('dashboard.goToServers'),
    },
    projects: {
      icon: FolderOpen,
      title: t('dashboard.nextStepProjects'),
      subtitle: t('dashboard.nextStepProjectsSubtitle'),
      action: () => navigate('/projects'),
      label: t('dashboard.goToProjects'),
    },
    containers: {
      icon: Box,
      title: t('dashboard.nextStepContainers'),
      subtitle: t('dashboard.nextStepContainersSubtitle'),
      action: () => navigate('/deployments'),
      label: t('dashboard.goToContainers'),
    },
    deploy: {
      icon: Rocket,
      title: t('dashboard.nextStepDeploy'),
      subtitle: t('dashboard.nextStepDeploySubtitle'),
      action: () => navigate('/deployments'),
      label: t('dashboard.goToContainers'),
    },
  }

  // Container stat sublabel.
  const containerSublabel = containers.length > 0 ? (
    <div className="flex items-center gap-2 flex-wrap">
      {running > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
          {running} {t('dashboard.statusRunning')}
        </span>
      )}
      {stopped > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-text-disabled">
          <span className="h-1.5 w-1.5 rounded-full bg-grey-300 inline-block" />
          {stopped} {t('dashboard.statusStopped')}
        </span>
      )}
      {errored > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-destructive">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive inline-block" />
          {errored} {t('dashboard.statusError')}
        </span>
      )}
    </div>
  ) : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t('dashboard.welcome', { name: firstName })} 👋`}
        subtitle={t('dashboard.subtitle')}
        action={
          <div className="flex items-center gap-2">
            {hasServers && (
              <Button variant="secondary" onClick={() => navigate('/deployments')}>
                <Zap size={14} />{t('dashboard.newContainer')}
              </Button>
            )}
            <Button onClick={() => navigate('/server')}>
              <Server size={14} />{t('dashboard.connectServer')}
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label={t('dashboard.servers')}
          value={servers.length}
          onClick={() => navigate('/server')}
        />
        <StatCard
          icon={Box}
          label={t('dashboard.deployments')}
          value={deploymentCount}
          sublabel={containerSublabel}
          accent={errored > 0 ? 'error' : 'default'}
          onClick={() => navigate('/deployments')}
        />
        <StatCard
          icon={FolderOpen}
          label={t('dashboard.projects')}
          value={projects.length}
          onClick={() => navigate('/projects')}
        />
        <StatCard
          icon={Users}
          label={t('dashboard.members')}
          value={members.length}
          onClick={() => navigate('/members')}
        />
      </div>

      {/* Alerts for containers with errors. */}
      {errorContainers.length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/[0.03] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-destructive shrink-0" />
            <p className="text-sm font-semibold text-destructive">
              {t('dashboard.containerIssues', { count: errorContainers.length })}
            </p>
          </div>
          <div className="space-y-1.5">
            {errorContainers.map(c => (
              <button
                key={c.id}
                onClick={() => navigate(`/containers/${c.id}`)}
                className="w-full flex items-center justify-between rounded-lg border border-destructive/10 bg-background-paper px-3 py-2 text-left hover:border-destructive/30 transition-colors"
              >
                <span className="text-sm font-medium text-text-primary truncate">{c.name}</span>
                <span className="text-xs text-destructive font-medium shrink-0 ml-2">
                  {t('dashboard.statusError')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Next step. */}
      {nextStep && (() => {
        const cfg = stepConfig[nextStep]
        return (
          <Card>
            <EmptyState
              icon={cfg.icon}
              title={cfg.title}
              subtitle={cfg.subtitle}
              action={{ label: cfg.label, onClick: cfg.action, icon: <ArrowRight size={13} /> }}
            />
          </Card>
        )
      })()}
    </div>
  )
}
