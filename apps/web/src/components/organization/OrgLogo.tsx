import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const DEFAULT_ORG_LOGO = '/favicon.svg'

interface OrgLogoProps {
  src?: string | null
  alt: string
  className?: string
  fallbackClassName?: string
}

export function OrgLogo({ src, alt, className, fallbackClassName }: OrgLogoProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const useDefaultLogo = !src || failed

  return (
    <img
      src={useDefaultLogo ? DEFAULT_ORG_LOGO : src}
      alt={useDefaultLogo ? 'Zoneploy' : alt}
      className={cn('object-contain', className, useDefaultLogo && fallbackClassName)}
      onError={() => {
        if (!useDefaultLogo) setFailed(true)
      }}
    />
  )
}
