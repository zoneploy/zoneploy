import { Link, useLocation, useMatches } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

interface RouteHandleContext {
  pathname: string
  params: Record<string, string | undefined>
  search: string
}

interface RouteHandle {
  title?: string | ((ctx: RouteHandleContext) => string)
  crumbs?: { label: string; to?: string }[] | ((ctx: RouteHandleContext) => { label: string; to?: string }[])
}

export function Breadcrumb() {
  const { t } = useTranslation()
  const matches = useMatches()
  const location = useLocation()
  const hasOrg = useAuthStore(s => !!s.session?.org)

  // Build breadcrumb list from route handles.
  const crumbs: { label: string; to?: string }[] = [{ label: t('nav.home'), to: hasOrg ? '/projects' : '/dashboard' }]

  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined
    const ctx = {
      pathname: match.pathname,
      params: match.params as Record<string, string | undefined>,
      search: location.search,
    }
    if (handle?.crumbs) {
      crumbs.push(...(typeof handle.crumbs === 'function' ? handle.crumbs(ctx) : handle.crumbs))
    } else if (handle?.title) {
      const title = typeof handle.title === 'function' ? handle.title(ctx) : handle.title
      crumbs.push({ label: title, to: match.pathname })
    }
  }

  // Hide when only "Home" is present.
  if (crumbs.length <= 1) return null

  return (
    <nav className="flex items-center gap-1.5 text-sm text-text-secondary mb-6">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i === 0 ? (
              crumb.to ? (
                <Link
                  to={crumb.to}
                  className="flex items-center gap-1 hover:text-text-primary transition-colors"
                >
                  <Home size={14} />
                  <span className="hidden sm:inline">{crumb.label}</span>
                </Link>
              ) : (
                <span className="flex items-center gap-1">
                  <Home size={14} />
                  <span className="hidden sm:inline">{crumb.label}</span>
                </span>
              )
            ) : isLast ? (
              <span className={cn('font-medium', 'text-text-primary')}>{t(crumb.label, { defaultValue: crumb.label })}</span>
            ) : crumb.to ? (
              <Link to={crumb.to} className="hover:text-text-primary transition-colors">
                {t(crumb.label, { defaultValue: crumb.label })}
              </Link>
            ) : (
              <span>{t(crumb.label, { defaultValue: crumb.label })}</span>
            )}
            {!isLast && <ChevronRight size={13} className="text-text-disabled shrink-0" />}
          </span>
        )
      })}
    </nav>
  )
}
