import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { mode } = useTheme()
  const isDark = mode === 'dark'

  return (
    <div className="bg-waves flex min-h-screen w-full items-center justify-center p-4">
      <div
        className={cn(
          'flex min-h-[400px] w-full max-w-[800px] flex-col items-center justify-center rounded-[2rem] py-14 px-8 sm:px-14',
          'border border-grey-100/60 shadow-darker-md',
          isDark
            ? "bg-[url('/error-background-dark.svg')]"
            : "bg-[url('/error-background-light.svg')]",
          'bg-background-paper bg-center bg-no-repeat',
        )}
      >
        <div className="mb-14 flex justify-center">
          <Logo className="gap-2.5" />
        </div>

        <div className="flex flex-col items-center gap-4">
          <h1 className="text-3xl font-bold text-text-primary text-center">
            {t('notFound.title')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('notFound.code')}
          </p>
          <Button onClick={() => navigate('/', { replace: true })}>
            <Home size={15} />
            {t('common.goHome')}
          </Button>
        </div>
      </div>
    </div>
  )
}
