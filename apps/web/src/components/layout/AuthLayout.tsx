import { Logo } from '@/components/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { cn } from '@/lib/utils'

interface AuthLayoutProps {
  children: React.ReactNode
  /** Maximum card width. Default: max-w-lg. */
  maxWidth?: string
}

export function AuthLayout({ children, maxWidth = 'max-w-lg' }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-waves bg-cover bg-center flex items-center justify-center p-4 relative">
      {/* Language switcher */}
      <LanguageSwitcher className="absolute top-4 right-4" />

      {/* Card */}
      <div className={cn('w-full bg-background-paper rounded-4xl shadow-darker-xs py-14 px-8 sm:px-14', maxWidth)}>
        {/* Logo */}
        <div className="flex justify-center mb-12">
          <Logo />
        </div>

        {children}
      </div>
    </div>
  )
}
