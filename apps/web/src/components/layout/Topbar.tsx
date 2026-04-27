import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, Moon, LogOut, Settings, User,
  ChevronRight, MessageSquare,
  Search, LayoutGrid, Bell, Menu,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLogout } from '@/hooks/useAuth'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuthStore } from '@/stores/auth'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'

// Language data with flags
const LANGUAGES = [
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

export function Topbar({ title: _title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const logout = useLogout()
  const navigate = useNavigate()
  const { mode, toggleMode } = useTheme()
  const { i18n, t } = useTranslation()
  const session = useAuthStore(s => s.session)

  const [userOpen, setUserOpen]   = useState(false)
  const [langOpen, setLangOpen]   = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserOpen(false)
        setLangOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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
    <header className="fixed top-0 left-0 right-0 z-40 h-20 bg-background-paper shadow-darker-xs rounded-b-3xl">
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        {/* Left side: mobile hamburger plus logo. */}
        <div className="flex items-center gap-2">
          <button
            onClick={onMenuClick}
            className="md:hidden h-10 w-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors"
          >
            <Menu size={20} />
          </button>
          <Logo />
        </div>

        {/* Acciones derecha */}
        <div className="flex items-center gap-0.5">
          {/* Search */}
          <button className="h-10 w-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors">
            <Search size={18} />
          </button>
          {/* Shortcuts */}
          <button className="h-10 w-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors">
            <LayoutGrid size={18} />
          </button>
          {/* Notificaciones */}
          <button className="h-10 w-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors">
            <Bell size={18} />
          </button>
          {/* Dark/Light */}
          <button
            onClick={toggleMode}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-grey-50 hover:text-text-primary transition-colors"
          >
            {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User button without arrow. */}
          <div ref={userRef} className="relative ml-1">
            <button
              onClick={() => { setUserOpen(v => !v); setLangOpen(false) }}
              className={cn(
                'h-10 flex items-center gap-2 pl-3 pr-1 rounded-xl text-text-primary hover:bg-grey-50 transition-colors',
                userOpen && 'bg-grey-50',
              )}
            >
              <span className="hidden sm:block text-sm font-medium">
                {session?.user?.fullName ?? t('topbar.user')}
              </span>
              <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                {initials}
              </div>
            </button>

            {/* Dropdown. */}
            {userOpen && (
              <div className="absolute right-0 top-full mt-3 w-72 bg-background-paper rounded-2xl shadow-darker-md border border-grey-100 overflow-visible z-50">
                <div className="px-5 py-5">
                  {/* Avatar + info */}
                  <div className="flex flex-col items-center mb-4">
                    <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center text-primary text-lg font-bold mb-2">
                      {initials}
                    </div>
                    <p className="text-sm font-semibold text-text-primary">{session?.user?.fullName}</p>
                    <p className="text-xs text-text-secondary">{session?.user?.email}</p>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-grey-100" />

                {/* Menu items. */}
                <div className="px-2 py-1.5">
                  <MenuItem icon={User} label={t('topbar.profile')} onClick={() => { navigate('/profile'); setUserOpen(false) }} />
                  {session?.org && (
                    <MenuItem icon={Settings} label={t('topbar.configuration')} onClick={() => { navigate('/settings'); setUserOpen(false) }} />
                  )}
                </div>
                <div className="h-px bg-grey-100" />

                {/* Modo + Idioma */}
                <div className="px-2 py-1.5">
                  {/* Modo */}
                  <button
                    onClick={toggleMode}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-grey-50 transition-colors"
                  >
                    <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-grey-50 text-text-secondary shrink-0">
                      {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                    </div>
                    <span className="flex-1 text-left">{t('topbar.mode')}</span>
                    <span className="text-xs font-medium text-text-secondary border border-grey-200 rounded-md px-2 py-0.5">
                      {mode === 'dark' ? t('topbar.modeDark') : t('topbar.modeLight')}
                    </span>
                    <ChevronRight size={13} className="text-text-disabled" />
                  </button>

                  {/* Idioma */}
                  <div className="relative">
                    <button
                      onClick={() => setLangOpen(v => !v)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-grey-50 transition-colors',
                        langOpen && 'bg-grey-50',
                      )}
                    >
                      <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-grey-50 text-text-secondary shrink-0">
                        <MessageSquare size={15} />
                      </div>
                      <span className="flex-1 text-left">{t('topbar.language')}</span>
                      <span className="text-xs font-medium text-text-secondary border border-grey-200 rounded-md px-2 py-0.5 flex items-center gap-1">
                        {currentLang.flag} {currentLang.label}
                      </span>
                      <ChevronRight size={13} className={cn('text-text-disabled transition-transform', langOpen && 'rotate-90')} />
                    </button>

                    {langOpen && (
                      <div className="absolute left-0 right-0 mt-0.5 bg-background-paper rounded-xl border border-grey-100 shadow-darker-xs overflow-hidden z-10">
                        {LANGUAGES.map(lang => (
                          <button
                            key={lang.code}
                            onClick={() => changeLanguage(lang.code)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-grey-50 transition-colors',
                              i18n.language?.startsWith(lang.code)
                                ? 'text-primary font-medium'
                                : 'text-text-primary',
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

                {/* Divider */}
                <div className="h-px bg-grey-100" />

                {/* Sign out */}
                <div className="px-5 py-4">
                  <button
                    onClick={() => { logout(); setUserOpen(false) }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-grey-200 py-2 text-sm font-medium text-text-secondary hover:bg-grey-50 transition-colors"
                  >
                    <LogOut size={15} />
                    {t('auth.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// Helper component
function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-grey-50 transition-colors"
    >
      <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-grey-50 text-text-secondary shrink-0">
        <Icon size={15} />
      </div>
      {label}
    </button>
  )
}
