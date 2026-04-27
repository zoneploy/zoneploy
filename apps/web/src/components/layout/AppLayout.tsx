import { useState } from 'react'
import { Outlet, useLocation, useMatches } from 'react-router-dom'
import { PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { Breadcrumb } from './Breadcrumb'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'

interface RouteHandleContext {
  pathname: string
  params: Record<string, string | undefined>
  search: string
}

interface RouteHandle {
  title?: string | ((ctx: RouteHandleContext) => string)
}

export function AppLayout() {
  const { t } = useTranslation()
  const matches = useMatches()
  const location = useLocation()
  const session = useAuthStore(s => s.session)
  const currentMatch = matches[matches.length - 1]
  const currentHandle = currentMatch?.handle as RouteHandle | undefined
  const title =
    typeof currentHandle?.title === 'function'
      ? currentHandle.title({
          pathname: currentMatch?.pathname ?? location.pathname,
          params: (currentMatch?.params ?? {}) as Record<string, string | undefined>,
          search: location.search,
        })
      : (currentHandle?.title ?? 'Zoneploy')

  // Estado collapsed persistido en localStorage
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    localStorage.getItem('sidebar-collapsed') === 'true',
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed(v => {
      localStorage.setItem('sidebar-collapsed', String(!v))
      return !v
    })
  }

  // Suppress unused variable warning; session can be used later for the banner.
  void session

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Content area offset by sidebar width. */}
      <div className={cn(
        'flex flex-col min-h-screen transition-[padding] duration-300',
        collapsed ? 'md:pl-16' : 'md:pl-[320px]',
      )}>
        {/* Content header. */}
        <div className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4 sm:px-5 bg-background/90 backdrop-blur-sm border-b border-grey-100/50">
          <button
            onClick={toggleCollapsed}
            className="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors"
          >
            <PanelLeft size={17} />
          </button>
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden h-8 w-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors"
          >
            <PanelLeft size={17} />
          </button>
          <h1 className="text-sm font-semibold text-text-primary">{t(title, { defaultValue: title })}</h1>
        </div>

        {/* Page content. */}
        <div className="flex flex-1 w-full min-w-0 px-4 py-6 sm:px-6 md:py-8 lg:px-10">
          <div className="mx-auto w-full max-w-screen-lg">
            <Breadcrumb />
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
