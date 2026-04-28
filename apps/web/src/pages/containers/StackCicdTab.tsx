import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, RefreshCw, Trash2, Check, Terminal } from 'lucide-react'
import { stacksApi } from '@/api/stacks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className={cn('flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors', className)}
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  )
}

function getActionApiUrl() {
  const configured = import.meta.env.VITE_API_URL ?? '/api/v1'
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, '')

  const path = configured.startsWith('/') ? configured : `/${configured}`
  return `${window.location.origin}${path}`.replace(/\/$/, '')
}

export function StackCicdTab({
  orgId,
  stackId,
  hasToken,
}: {
  orgId: string
  stackId: string
  hasToken: boolean
}) {
  const { t } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [tokenExists, setTokenExists] = useState(hasToken)
  const apiUrl = getActionApiUrl()

  const generate = useMutation({
    mutationFn: () => stacksApi.generateDeployToken(orgId, stackId),
    onSuccess: (data) => {
      setToken(data.token)
      setTokenExists(true)
    },
  })

  const revoke = useMutation({
    mutationFn: () => stacksApi.revokeDeployToken(orgId, stackId),
    onSuccess: () => {
      setToken(null)
      setTokenExists(false)
    },
  })

  const githubActionTemplate = `name: Deploy to Zoneploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: zoneploy/zoneploy-action@main
        with:
          api-url: ${apiUrl}
          deploy-token: \${{ secrets.ZP_DEPLOY_TOKEN }}
          github-token: \${{ github.token }}
          target: stack
          compose-file: docker-compose.yml`

  return (
    <div className="space-y-4">
      {/* Token */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('cicd.tokenTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-text-secondary">{t('stacks.cicd.tokenDesc')}</p>

          {token && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
              <p className="text-xs font-medium text-success">{t('cicd.tokenOnce')}</p>
              <div className="flex items-center gap-2 bg-background rounded-md px-3 py-2 font-mono text-xs text-text-primary break-all">
                <span className="flex-1">{token}</span>
                <CopyButton text={token} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={tokenExists ? 'outline' : 'default'}
              onClick={() => generate.mutate()}
              loading={generate.isPending}
            >
              <RefreshCw size={13} />
              {tokenExists ? t('cicd.regenerate') : t('cicd.generate')}
            </Button>

            {tokenExists && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => revoke.mutate()}
                loading={revoke.isPending}
              >
                <Trash2 size={13} />
                {t('cicd.revoke')}
              </Button>
            )}

            {tokenExists && !token && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                {t('cicd.tokenActive')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Template */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Terminal size={14} />
              {t('cicd.templateTitle')}
            </CardTitle>
            <CopyButton text={githubActionTemplate} />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-secondary mb-3">{t('stacks.cicd.templateDesc')}</p>
          <pre className="rounded-lg bg-grey-50 border border-grey-100 p-3 text-[11px] text-text-primary overflow-x-auto leading-relaxed">
            <code>{githubActionTemplate}</code>
          </pre>
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
            <p className="text-xs font-semibold text-text-primary">{t('cicd.setupSteps')}</p>
            <ol className="text-xs text-text-secondary space-y-1 list-decimal list-inside">
              <li>{t('stacks.cicd.step1')}</li>
              <li>{t('stacks.cicd.step2')}</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
