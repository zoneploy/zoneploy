import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  iconOnly?: boolean
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Icon: hexagon with upward arrow, matching favicon.svg. */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 256 256"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <rect x="16" y="16" width="224" height="224" rx="56" fill="#00C7EB" />
        <path d="M128 46L194 84V172L128 210L62 172V84L128 46Z" stroke="white" strokeWidth="16" strokeLinejoin="round" />
        <path d="M128 88V164" stroke="white" strokeWidth="18" strokeLinecap="round" />
        <path d="M94 122L128 88L162 122" stroke="white" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {!iconOnly && (
        <span className="font-heading font-bold text-xl tracking-tight text-text-primary">
          Zone<span className="text-primary">ploy</span>
        </span>
      )}
    </div>
  )
}
