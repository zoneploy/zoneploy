import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, ExternalLink, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  stacksApi,
  type StackCustomEndpointInfo,
  type StackDomainsResponse,
} from '@/api/stacks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/spinner'
import { getApiError } from '@/lib/errors'
import {
  DnsRecordCard,
  ServiceMeta,
  isValidHostname,
  isValidPort,
  sanitizeHostname,
  sanitizePort,
} from './domain-ui'

function StackCustomRow({
  orgId,
  stackId,
  endpoint,
  canManage,
  onChanged,
}: {
  orgId: string
  stackId: string
  endpoint: StackCustomEndpointInfo
  canManage: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [draftHostname, setDraftHostname] = useState(endpoint.hostname)
  const [draftPort, setDraftPort] = useState(String(endpoint.port))

  const resetDraft = () => {
    setDraftHostname(endpoint.hostname)
    setDraftPort(String(endpoint.port))
    setIsEditing(false)
  }

  const update = useMutation({
    mutationFn: () => stacksApi.updateCustomDomain(orgId, stackId, endpoint.id, {
      customDomain: draftHostname.trim(),
      port: Number(draftPort),
    }),
    onSuccess: () => {
      setIsEditing(false)
      onChanged()
    },
  })

  const remove = useMutation({
    mutationFn: () => stacksApi.removeCustomDomain(orgId, stackId, endpoint.id),
    onSuccess: onChanged,
  })

  const verify = useMutation({
    mutationFn: () => stacksApi.verifyCustomDomain(orgId, stackId, endpoint.id),
    onSuccess: onChanged,
  })

  const hostnameChanged = draftHostname.trim() !== endpoint.hostname
  const changed = hostnameChanged || Number(draftPort) !== endpoint.port
  const canSave = isValidHostname(draftHostname.trim()) && isValidPort(draftPort) && changed

  if (isEditing) {
    return (
      <div className="rounded-xl border border-primary/20 bg-background-paper p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('domains.hostname')}</Label>
            <Input value={draftHostname} onChange={event => setDraftHostname(sanitizeHostname(event.target.value))} placeholder={t('domains.customPlaceholder')} />
            {endpoint.verified && hostnameChanged && (
              <p className="text-[11px] text-amber-400">{t('domains.reverifyAfterHostnameChange')}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('domains.colPort')}</Label>
            <Input value={draftPort} onChange={event => setDraftPort(sanitizePort(event.target.value))} placeholder="3000" />
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={() => update.mutate()} loading={update.isPending} disabled={!canSave}>
              {t('common.save')}
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={resetDraft}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
        {update.error && <p className="mt-3 text-xs text-red-400">{getApiError(update.error, t)}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-background-paper p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {endpoint.verified ? (
              <CheckCircle size={14} className="shrink-0 text-emerald-400" />
            ) : (
              <XCircle size={14} className="shrink-0 text-amber-400" />
            )}
            <p className="break-all font-mono text-sm text-text-primary">{endpoint.hostname}</p>
            {endpoint.isPrimary && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {t('domains.primary')}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              endpoint.verified ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}>
              {endpoint.verified ? t('domains.verified') : t('domains.pendingVerification')}
            </span>
          </div>
          <p className="text-xs text-text-secondary">{t('domains.portLabel', { port: endpoint.port })}</p>
          <ServiceMeta resolvedServiceName={endpoint.resolvedServiceName} portResolved={endpoint.portResolved} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {endpoint.verified && (
            <a
              href={`https://${endpoint.hostname}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-grey-100 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:border-grey-200 hover:bg-grey-25"
            >
              <ExternalLink size={12} />
              {t('common.open')}
            </a>
          )}
          {canManage && !endpoint.verified && (
            <Button size="sm" variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending}>
              {t('domains.verify')}
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
              <Pencil size={12} />
              {t('common.edit')}
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => remove.mutate()} className="text-destructive hover:text-destructive">
              <Trash2 size={12} />
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>

      {!endpoint.verified && (
        <DnsRecordCard
          recordType={endpoint.dnsRecordType}
          hostname={endpoint.hostname}
          target={endpoint.dnsTarget}
          routingMode={endpoint.routingMode}
        />
      )}
      {remove.error && <p className="text-xs text-red-400">{getApiError(remove.error, t)}</p>}
      {verify.error && <p className="text-xs text-red-400">{getApiError(verify.error, t)}</p>}
      {verify.data && !verify.data.verified && <p className="text-xs text-red-400">{t('domains.verifyFailed')}</p>}
    </div>
  )
}

export function StackDomainsTab({
  orgId,
  stackId,
  canManage,
}: {
  orgId: string
  stackId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [newPort, setNewPort] = useState('')
  const [newHostname, setNewHostname] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['stack-domains', stackId],
    queryFn: () => stacksApi.listDomains(orgId, stackId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['stack-domains', stackId] })
  }

  const addCustom = useMutation({
    mutationFn: () => stacksApi.addCustomDomain(orgId, stackId, {
      port: Number(newPort),
      customDomain: newHostname.trim(),
    }),
    onSuccess: () => {
      setNewPort('')
      setNewHostname('')
      invalidate()
    },
  })

  const endpoints = data ?? ({
    custom: [],
    customRouting: {
      mode: 'disabled',
      enabled: false,
      serverId: null,
      dnsTarget: '',
      dnsRecordType: null,
    },
  } satisfies StackDomainsResponse)
  const customDomainsReady = endpoints.customRouting.enabled
  const addDisabled = !isValidPort(newPort) || !isValidHostname(newHostname.trim()) || !customDomainsReady

  if (isLoading) return <LoadingState className="py-6" />

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-grey-100 bg-background-paper p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t('domains.addDomainTitle')}</h3>
          <p className="mt-1 text-xs text-text-secondary">{t('domains.customSectionHint')}</p>
        </div>

        {canManage && (
          <form
            className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_auto]"
            onSubmit={event => {
              event.preventDefault()
              if (addDisabled) return
              addCustom.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">{t('domains.colPort')}</Label>
              <Input value={newPort} onChange={event => setNewPort(sanitizePort(event.target.value))} placeholder="3000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('domains.hostname')}</Label>
              <Input value={newHostname} onChange={event => setNewHostname(sanitizeHostname(event.target.value))} placeholder={t('domains.customPlaceholder')} />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full md:w-auto" loading={addCustom.isPending} disabled={addDisabled}>
                <Plus size={12} />
                {t('common.add')}
              </Button>
            </div>
          </form>
        )}

        {!customDomainsReady && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
            <p className="text-sm font-medium text-amber-300">{t('domains.customRoutingUnavailableTitle')}</p>
            <p className="mt-1 text-xs text-amber-200/90">{t('domains.customRoutingUnavailableHint')}</p>
          </div>
        )}
        {addCustom.error && <p className="text-xs text-red-400">{getApiError(addCustom.error, t)}</p>}
      </div>

      <div className="rounded-2xl border border-grey-100 bg-background-paper p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">{t('domains.connectedDomainsTitle')}</h3>

        {endpoints.custom.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('domains.customEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {endpoints.custom.map(endpoint => (
              <StackCustomRow
                key={endpoint.id}
                orgId={orgId}
                stackId={stackId}
                endpoint={endpoint}
                canManage={canManage}
                onChanged={invalidate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
