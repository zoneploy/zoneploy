import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { authApi, type OAuthProvider } from '@/api/auth'
import { getApiError } from '@/lib/errors'

function GoogleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M19.6169 10.2876C19.6169 9.60932 19.5561 8.95714 19.443 8.33105H10.4343V12.0354H15.5822C15.3561 13.2267 14.6778 14.2354 13.6604 14.9137V17.3224H16.7648C18.5735 15.6528 19.6169 13.2006 19.6169 10.2876Z"
        fill="#4285F4"
      />
      <path
        d="M10.4346 19.6346C13.0172 19.6346 15.1825 18.7825 16.7651 17.3216L13.6607 14.9129C12.8086 15.4868 11.7216 15.8346 10.4346 15.8346C7.94768 15.8346 5.83464 14.1564 5.07812 11.8955H1.89551V14.3651C3.46942 17.4868 6.69551 19.6346 10.4346 19.6346Z"
        fill="#34A853"
      />
      <path
        d="M5.07832 11.8866C4.88702 11.3127 4.77398 10.704 4.77398 10.0692C4.77398 9.4344 4.88702 8.8257 5.07832 8.25179V5.78223H1.89572C1.24354 7.06918 0.869629 8.52136 0.869629 10.0692C0.869629 11.617 1.24354 13.0692 1.89572 14.3561L4.37398 12.4257L5.07832 11.8866Z"
        fill="#FBBC05"
      />
      <path
        d="M10.4346 4.31358C11.8433 4.31358 13.0955 4.80054 14.0955 5.73967L16.8346 3.00054C15.1738 1.45271 13.0172 0.504883 10.4346 0.504883C6.69551 0.504883 3.46942 2.65271 1.89551 5.78314L5.07812 8.25271C5.83464 5.99184 7.94768 4.31358 10.4346 4.31358Z"
        fill="#EA4335"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5 shrink-0 text-text-primary"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M10 0.0693359C4.475 0.0693359 0 4.54434 0 10.0693C0 14.4943 2.8625 18.2318 6.8375 19.5568C7.3375 19.6443 7.525 19.3443 7.525 19.0818C7.525 18.8443 7.5125 18.0568 7.5125 17.2193C5 17.6818 4.35 16.6068 4.15 16.0443C4.0375 15.7568 3.55 14.8693 3.125 14.6318C2.775 14.4443 2.275 13.9818 3.1125 13.9693C3.9 13.9568 4.4625 14.6943 4.65 14.9943C5.55 16.5068 6.9875 16.0818 7.5625 15.8193C7.65 15.1693 7.9125 14.7318 8.2 14.4818C5.975 14.2318 3.65 13.3693 3.65 9.54434C3.65 8.45684 4.0375 7.55684 4.675 6.85684C4.575 6.60684 4.225 5.58184 4.775 4.20684C4.775 4.20684 5.6125 3.94434 7.525 5.23184C8.325 5.00684 9.175 4.89434 10.025 4.89434C10.875 4.89434 11.725 5.00684 12.525 5.23184C14.4375 3.93184 15.275 4.20684 15.275 4.20684C15.825 5.58184 15.475 6.60684 15.375 6.85684C16.0125 7.55684 16.4 8.44434 16.4 9.54434C16.4 13.3818 14.0625 14.2318 11.8375 14.4818C12.2 14.7943 12.5125 15.3943 12.5125 16.3318C12.5125 17.6693 12.5 18.7443 12.5 19.0818C12.5 19.3443 12.6875 19.6568 13.1875 19.5568C17.1375 18.2318 20 14.4818 20 10.0693C20 4.54434 15.525 0.0693359 10 0.0693359Z"
      />
    </svg>
  )
}

function getOAuthStateKey(provider: OAuthProvider) {
  return `zp_oauth_state_${provider}`
}

export function SocialAuthButtons() {
  const { t } = useTranslation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const startOAuth = useMutation({
    mutationFn: async (provider: OAuthProvider) => {
      const state = crypto.randomUUID()
      sessionStorage.setItem(getOAuthStateKey(provider), state)
      const { authorizationUrl } = await authApi.oauthAuthorize(provider, state)
      return authorizationUrl
    },
    onSuccess: authorizationUrl => {
      window.location.href = authorizationUrl
    },
    onError: error => {
      setErrorMessage(getApiError(error, t))
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-10 flex-none rounded-md border-grey-100 bg-background-paper px-4 text-[13px] font-medium text-text-primary hover:bg-grey-20 md:w-1/2 md:text-sm whitespace-nowrap"
          loading={startOAuth.isPending && startOAuth.variables === 'google'}
          onClick={() => {
            setErrorMessage(null)
            startOAuth.mutate('google')
          }}
        >
          <GoogleIcon />
          {t('auth.continueWithGoogle')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-10 flex-none rounded-md border-grey-100 bg-background-paper px-4 text-[13px] font-medium text-text-primary hover:bg-grey-20 md:w-1/2 md:text-sm whitespace-nowrap"
          loading={startOAuth.isPending && startOAuth.variables === 'github'}
          onClick={() => {
            setErrorMessage(null)
            startOAuth.mutate('github')
          }}
        >
          <GitHubIcon />
          {t('auth.continueWithGithub')}
        </Button>
      </div>

      <div className="relative">
        <div className="h-px bg-grey-100" />
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-background-paper px-3 text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
          {t('auth.or')}
        </span>
      </div>

      {errorMessage && (
        <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
          {errorMessage}
        </div>
      )}
    </div>
  )
}
