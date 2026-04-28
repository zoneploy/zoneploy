import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { copyTextToClipboard } from '@/lib/clipboard'

export function sanitizePort(value: string) {
  return value.replace(/[^\d]/g, '').slice(0, 5)
}

export function sanitizeHostname(value: string) {
  return value.trimStart().toLowerCase().slice(0, 253)
}

export function isValidPort(value: string) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

export function isValidHostname(value: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value)
}

export function ServiceMeta({
  resolvedServiceName,
  portResolved,
}: {
  resolvedServiceName?: string | null
  portResolved?: boolean
}) {
  const { t } = useTranslation()

  if (portResolved && resolvedServiceName) {
    return <p className="text-xs text-text-secondary">{t('domains.serviceLabel', { service: resolvedServiceName })}</p>
  }

  if (portResolved === false) {
    return <p className="text-xs text-amber-400">{t('domains.unresolvedPort')}</p>
  }

  return null
}

export function DnsRecordCard({
  recordType,
  hostname,
  target,
  routingMode,
}: {
  recordType: 'A' | 'AAAA' | 'CNAME' | null
  hostname: string
  target: string
  routingMode: 'server' | 'disabled'
}) {
  const { t } = useTranslation()

  if (!recordType || !target) return null
  const hint = recordType === 'CNAME'
    ? t('domains.hostnameDnsHint')
    : routingMode === 'server'
      ? t('domains.serverEdgeHint')
      : t('domains.ipDnsHint')

  return (
    <div className="rounded-xl border border-grey-100 bg-grey-25/70 p-3">
      <div className="mb-3">
        <p className="text-xs font-semibold text-text-primary">{t('domains.dnsSetupTitle')}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
          {hint}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-disabled">{t('domains.dnsType')}</p>
          <div className="rounded-lg border border-grey-100 bg-background-paper px-3 py-2 font-mono text-xs text-primary">
            {recordType}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-disabled">{t('domains.dnsName')}</p>
          <div className="rounded-lg border border-grey-100 bg-background-paper px-3 py-2 font-mono text-xs text-text-primary break-all">
            {hostname}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-disabled">{t('domains.dnsValue')}</p>
          <button
            type="button"
            onClick={() => copyTextToClipboard(target)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-grey-100 bg-background-paper px-3 py-2 text-left font-mono text-xs text-text-primary transition-colors hover:border-primary/40 hover:text-primary"
          >
            <span className="min-w-0 truncate">{target}</span>
            <Copy size={12} className="shrink-0" />
          </button>
        </div>
      </div>
    </div>
  )
}
