import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { useAuthStore } from '@/stores/auth'
import { DOCS_URL } from '@/lib/external-links'

function ExternalRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])

  return null
}

function GuestRoute() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated())
  const hasOrg = useAuthStore(s => !!s.session?.org)
  return isAuthenticated ? <Navigate to={hasOrg ? '/projects' : '/dashboard'} replace /> : <Outlet />
}

function DefaultAuthenticatedLanding() {
  const hasOrg = useAuthStore(s => !!s.session?.org)
  return <Navigate to={hasOrg ? '/projects' : '/dashboard'} replace />
}

function DashboardRoute() {
  const hasOrg = useAuthStore(s => !!s.session?.org)
  return hasOrg ? <Navigate to="/projects" replace /> : <DashboardPage />
}
import { LoginPage } from '@/pages/auth/LoginPage'
import { OAuthCallbackPage } from '@/pages/auth/OAuthCallbackPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { TermsPage } from '@/pages/legal/TermsPage'
import { PrivacyPage } from '@/pages/legal/PrivacyPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { OrgSettingsPage } from '@/pages/organization/OrgSettingsPage'
import { MembersPage } from '@/pages/members/MembersPage'
import { AcceptInvitationPage } from '@/pages/invitations/AcceptInvitationPage'
import { MyInvitationsPage } from '@/pages/invitations/MyInvitationsPage'
import { ServersPage } from '@/pages/servers/ServersPage'
import { ContainersPage } from '@/pages/containers/ContainersPage'
import { ContainerDetailPage } from '@/pages/containers/ContainerDetailPage'
import { StackDetailPage } from '@/pages/containers/StackDetailPage'
import { CreateOrgPage } from '@/pages/organization/CreateOrgPage'
import { CustomRolesPage } from '@/pages/organization/CustomRolesPage'
import { CustomRoleFormPage } from '@/pages/organization/CustomRoleFormPage'
import { AuditLogPage } from '@/pages/organization/AuditLogPage'
import { ProjectsPage } from '@/pages/projects/ProjectsPage'
import { ProjectDetailPage } from '@/pages/projects/ProjectDetailPage'
import { ProfilePage } from '@/pages/profile/ProfilePage'
import { SecurityPage } from '@/pages/security/SecurityPage'
import { NotificationsPage } from '@/pages/notifications/NotificationsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { AddonsPage } from '@/pages/organization/AddonsPage'
import { AddonManagePage } from '@/pages/organization/AddonManagePage'


export const router = createBrowserRouter([
  // Routes for unauthenticated users only.
  {
    element: <GuestRoute />,
    children: [
      { path: '/login',           element: <LoginPage /> },
      { path: '/register',        element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },

  // Public routes, always accessible.
  { path: '/verify-email',  element: <VerifyEmailPage /> },
  { path: '/auth/:provider/callback', element: <OAuthCallbackPage /> },
  { path: '/invite/:token', element: <AcceptInvitationPage /> },
  { path: '/terms',         element: <TermsPage /> },
  { path: '/privacy',       element: <PrivacyPage /> },
  { path: '/docs',          element: <ExternalRedirect to={DOCS_URL} /> },

  // Protected routes.
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DefaultAuthenticatedLanding /> },
          {
            path: 'dashboard',
            element: <DashboardRoute />,
            handle: { title: 'nav.dashboard', crumbs: [{ label: 'nav.dashboard' }] },
          },
          {
            path: 'deployments',
            element: <ContainersPage />,
            handle: { title: 'nav.deployments', crumbs: [{ label: 'nav.deployments' }] },
          },
          {
            path: 'containers',
            element: <Navigate to="/deployments" replace />,
          },
          {
            path: 'containers/:containerId',
            element: <ContainerDetailPage />,
            handle: {
              title: 'containers.itemTitle',
              crumbs: [
                { label: 'nav.deployments', to: '/deployments' },
                { label: 'containers.tabLabel', to: '/deployments?view=containers' },
                { label: 'containers.itemTitle' },
              ],
            },
          },
          {
            path: 'stacks/:stackId',
            element: <StackDetailPage />,
            handle: {
              title: ({ search }: { search: string }) => {
                const params = new URLSearchParams(search)
                const view = params.get('view')
                const service = params.get('service')
                return view === 'service' && service ? service : 'stacks.detailTitle'
              },
              crumbs: ({ search }: { search: string }) => {
                const params = new URLSearchParams(search)
                const view = params.get('view')
                const service = params.get('service')
                return [
                  { label: 'nav.deployments', to: '/deployments' },
                  { label: 'stacks.tabLabel', to: '/deployments?view=stacks' },
                  { label: 'stacks.itemTitle' },
                  ...(view === 'service' && service ? [{ label: service }] : []),
                ]
              },
            },
          },
          {
            path: 'server',
            element: <ServersPage />,
            handle: { title: 'servers.title', crumbs: [{ label: 'servers.title' }] },
          },
          {
            path: 'remote-servers',
            element: <Navigate to="/server" replace />,
          },
          {
            path: 'members',
            element: <MembersPage />,
            handle: {
              title: 'nav.members',
              crumbs: [{ label: 'nav.organization' }, { label: 'nav.members' }],
            },
          },
          {
            path: 'projects',
            element: <ProjectsPage />,
            handle: { title: 'nav.projects', crumbs: [{ label: 'nav.projects' }] },
          },
          {
            path: 'projects/:projectId',
            element: <ProjectDetailPage />,
            handle: {
              title: 'projects.environments',
              crumbs: [{ label: 'nav.projects', to: '/projects' }, { label: 'projects.environments' }],
            },
          },
          {
            path: 'addons',
            element: <AddonsPage />,
            handle: {
              title: 'nav.addons',
              crumbs: [{ label: 'nav.organization' }, { label: 'nav.addons' }],
            },
          },
          {
            path: 'addons/:serverId/:addonSlug',
            element: <AddonManagePage />,
            handle: {
              title: 'addons.managePageTitle',
              crumbs: [
                { label: 'nav.organization' },
                { label: 'nav.addons', to: '/addons' },
                { label: 'addons.managePageTitle' },
              ],
            },
          },
          {
            path: 'custom-roles',
            element: <CustomRolesPage />,
            handle: {
              title: 'nav.customRoles',
              crumbs: [{ label: 'nav.organization' }, { label: 'nav.customRoles' }],
            },
          },
          {
            path: 'custom-roles/new',
            element: <CustomRoleFormPage />,
            handle: {
              title: 'customRoles.createTitle',
              crumbs: [
                { label: 'nav.organization' },
                { label: 'nav.customRoles', to: '/custom-roles' },
                { label: 'customRoles.createTitle' },
              ],
            },
          },
          {
            path: 'custom-roles/:roleId/edit',
            element: <CustomRoleFormPage />,
            handle: {
              title: 'customRoles.editTitle',
              crumbs: [
                { label: 'nav.organization' },
                { label: 'nav.customRoles', to: '/custom-roles' },
                { label: 'customRoles.editTitle' },
              ],
            },
          },
          {
            path: 'audit',
            element: <AuditLogPage />,
            handle: {
              title: 'nav.audit',
              crumbs: [{ label: 'nav.organization' }, { label: 'nav.audit' }],
            },
          },
          {
            path: 'settings',
            element: <OrgSettingsPage />,
            handle: {
              title: 'nav.settings',
              crumbs: [{ label: 'nav.organization' }, { label: 'nav.settings' }],
            },
          },
          {
            path: 'invitations',
            element: <MyInvitationsPage />,
            handle: {
              title: 'invitations.myTitle',
              crumbs: [{ label: 'invitations.myTitle' }],
            },
          },
          {
            path: 'organizations/new',
            element: <CreateOrgPage />,
            handle: {
              title: 'organization.createTitle',
              crumbs: [{ label: 'organization.createTitle' }],
            },
          },
          {
            path: 'profile',
            element: <ProfilePage />,
            handle: {
              title: 'profile.title',
              crumbs: [{ label: 'profile.title' }],
            },
          },
          {
            path: 'security',
            element: <SecurityPage />,
            handle: {
              title: 'topbar.security',
              crumbs: [{ label: 'topbar.security' }],
            },
          },
          {
            path: 'notifications',
            element: <NotificationsPage />,
            handle: {
              title: 'notifications.title',
              crumbs: [{ label: 'notifications.title' }],
            },
          },
        ],
      },
    ],
  },

  // Catch-all 404.
  { path: '*', element: <NotFoundPage /> },
])
