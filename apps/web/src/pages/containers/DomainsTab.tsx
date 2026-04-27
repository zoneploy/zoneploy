import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, ExternalLink, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  domainsApi,
  type ContainerDomainsResponse,
  type CustomEndpointInfo,
  type ZoneployEndpointInfo,
} from '@/api/domains'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import { getApiError } from '@/lib/errors'
import {
  DnsRecordCard,
  getZoneployDomainSuffix,
  isValidHostname,
  isValidPort,
  isValidZoneployName,
  sanitizeHostname,
  sanitizePort,
  sanitizeZoneployName,
} from './domain-ui'

function ZoneployEndpointRow({
  orgId,
  containerId,
  endpoint,
  canManage,
  onChanged,
}: {
  orgId: string
  containerId: string
  endpoint: ZoneployEndpointInfo
  canManage: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [draftSlug, setDraftSlug] = useState(endpoint.slug)
  const [draftPort, setDraftPort] = useState(String(endpoint.port))
  const domainSuffix = getZoneployDomainSuffix(endpoint.fullDomain, endpoint.slug)

  const resetDraft = () => {
    setDraftSlug(endpoint.slug)
    setDraftPort(String(endpoint.port))
    setIsEditing(false)
  }

  const update = useMutation({
    mutationFn: () => domainsApi.updateZoneploy(orgId, containerId, endpoint.id, {
      slug: draftSlug.trim(),
      port: Number(draftPort),
    }),
    onSuccess: () => {
      setIsEditing(false)
      onChanged()
    },
  })

  const remove = useMutation({
    mutationFn: () => domainsApi.removeZoneploy(orgId, containerId, endpoint.id),
    onSuccess: onChanged,
  })

  const changed = draftSlug.trim() !== endpoint.slug || Number(draftPort) !== endpoint.port
  const canSave = isValidZoneployName(draftSlug.trim()) && isValidPort(draftPort) && changed

  if (isEditing) {
    return (
      <div className="rounded-xl border border-primary/20 bg-background-paper p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('domains.zoneployName')}</Label>
            <div className="flex min-w-0 overflow-hidden rounded-md border border-grey-100 bg-background-paper focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
              <input
                value={draftSlug}
                onChange={event => setDraftSlug(sanitizeZoneployName(event.target.value))}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-text-primary outline-none"
              />
              <span className="shrink-0 border-l border-grey-100 bg-grey-25 px-3 py-2 font-mono text-xs text-text-secondary">
                {domainSuffix}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary">{t('domains.zoneployNameRules')}</p>
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
    <div className="rounded-xl border border-grey-100 bg-background-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="shrink-0 text-emerald-400" />
            <p className="break-all font-mono text-sm text-text-primary">{endpoint.fullDomain}</p>
            {endpoint.isPrimary && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {t('domains.primary')}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">{t('domains.portLabel', { port: endpoint.port })}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`https://${endpoint.fullDomain}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-grey-100 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:border-grey-200 hover:bg-grey-25"
          >
            <ExternalLink size={12} />
            {t('common.open')}
          </a>
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
      {remove.error && <p className="mt-3 text-xs text-red-400">{getApiError(remove.error, t)}</p>}
    </div>
  )
}

function CustomEndpointRow({
  orgId,
  containerId,
  endpoint,
  canManage,
  onChanged,
}: {
  orgId: string
  containerId: string
  endpoint: CustomEndpointInfo
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
    mutationFn: () => domainsApi.updateCustom(orgId, containerId, endpoint.id, {
      customDomain: draftHostname.trim(),
      port: Number(draftPort),
    }),
    onSuccess: () => {
      setIsEditing(false)
      onChanged()
    },
  })

  const remove = useMutation({
    mutationFn: () => domainsApi.removeCustom(orgId, containerId, endpoint.id),
    onSuccess: onChanged,
  })

  const verify = useMutation({
    mutationFn: () => domainsApi.verify(orgId, containerId, endpoint.id),
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

export function DomainsTab({
  orgId,
  containerId,
  canManage,
  needsRedeploy: initialNeedsRedeploy,
}: {
  orgId: string
  containerId: string
  canManage: boolean
  needsRedeploy: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [domainType, setDomainType] = useState<'zoneploy' | 'custom'>('zoneploy')
  const [newPort, setNewPort] = useState('')
  const [newHostname, setNewHostname] = useState('')
  const [needsRedeploy, setNeedsRedeploy] = useState(initialNeedsRedeploy)

  useEffect(() => {
    setNeedsRedeploy(initialNeedsRedeploy)
  }, [initialNeedsRedeploy])

  const { data, isLoading } = useQuery({
    queryKey: ['domains', containerId],
    queryFn: () => domainsApi.listAll(orgId, containerId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['domains', containerId] })
    queryClient.invalidateQueries({ queryKey: ['domain', containerId] })
    queryClient.invalidateQueries({ queryKey: ['container-domain-mappings', orgId, containerId] })
    queryClient.invalidateQueries({ queryKey: ['containers', orgId] })
    queryClient.invalidateQueries({ queryKey: ['container', orgId, containerId] })
  }

  const addZoneploy = useMutation({
    mutationFn: () => domainsApi.addZoneploy(orgId, containerId, Number(newPort)),
    onSuccess: () => {
      setNewPort('')
      invalidate()
    },
  })

  const addCustom = useMutation({
    mutationFn: () => domainsApi.addCustom(orgId, containerId, {
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
    zoneploy: [],
    custom: [],
    customRouting: {
      mode: 'disabled',
      enabled: false,
      addonSlug: 'custom-domains-edge',
      serverId: null,
      installationId: null,
      dnsTarget: '',
      dnsRecordType: null,
    },
  } satisfies ContainerDomainsResponse)
  const customDomainsReady = endpoints.customRouting.enabled
  const openAddons = () => navigate(endpoints.customRouting.serverId ? `/addons?serverId=${endpoints.customRouting.serverId}` : '/addons')
  const connectedDomains = useMemo(
    () => [...endpoints.zoneploy, ...endpoints.custom],
    [endpoints.custom, endpoints.zoneploy],
  )
  const addDisabled = !isValidPort(newPort)
    || (domainType === 'custom' && (!isValidHostname(newHostname.trim()) || !customDomainsReady))
  const addError = domainType === 'zoneploy' ? addZoneploy.error : addCustom.error

  if (isLoading) return <LoadingState className="py-4" />

  return (
    <div className="space-y-4">
      {needsRedeploy && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs text-amber-300">{t('domains.runtimeSyncPending')}</p>
        </div>
      )}

      <div className="rounded-2xl border border-grey-100 bg-background-paper p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t('domains.addDomainTitle')}</h3>
          <p className="mt-1 text-xs text-text-secondary">
            {domainType === 'zoneploy' ? t('domains.zoneployGeneratedHint') : t('domains.customSectionHint')}
          </p>
        </div>

        {canManage && (
          <form
            className="grid gap-3 md:grid-cols-[180px_140px_minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              if (addDisabled) return
              if (domainType === 'zoneploy') {
                addZoneploy.mutate()
                return
              }
              addCustom.mutate()
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">{t('domains.domainType')}</Label>
              <Select value={domainType} onChange={event => setDomainType(event.target.value as 'zoneploy' | 'custom')}>
                <option value="zoneploy">{t('domains.zoneployOption')}</option>
                <option value="custom">{t('domains.customOption')}</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('domains.colPort')}</Label>
              <Input value={newPort} onChange={event => setNewPort(sanitizePort(event.target.value))} placeholder="3000" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {domainType === 'zoneploy' ? t('domains.zoneployHostPreview') : t('domains.hostname')}
              </Label>
              {domainType === 'zoneploy' ? (
                <div className="flex h-10 items-center rounded-md border border-grey-100 bg-grey-25 px-3 text-sm text-text-secondary">
                  {t('domains.zoneployGeneratedValue')}
                </div>
              ) : (
                <Input value={newHostname} onChange={event => setNewHostname(sanitizeHostname(event.target.value))} placeholder={t('domains.customPlaceholder')} />
              )}
            </div>

            <div className="flex items-end">
              <Button type="submit" className="w-full md:w-auto" loading={addZoneploy.isPending || addCustom.isPending} disabled={addDisabled}>
                <Plus size={12} />
                {t('common.add')}
              </Button>
            </div>
          </form>
        )}

        {domainType === 'custom' && !customDomainsReady && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
            <p className="text-sm font-medium text-amber-300">{t('domains.customAddonRequiredTitle')}</p>
            <p className="mt-1 text-xs text-amber-200/90">{t('domains.customAddonRequiredHint')}</p>
            {canManage && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={openAddons}>
                  {t('domains.customAddonRequiredBtn')}
                </Button>
              </div>
            )}
          </div>
        )}

        {addError && <p className="text-xs text-red-400">{getApiError(addError, t)}</p>}
      </div>

      <div className="rounded-2xl border border-grey-100 bg-background-paper p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">{t('domains.connectedDomainsTitle')}</h3>

        {connectedDomains.length === 0 ? (
          <p className="text-sm text-text-secondary">{domainType === 'zoneploy' ? t('domains.zoneployEmpty') : t('domains.customEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {endpoints.zoneploy.map(endpoint => (
              <ZoneployEndpointRow
                key={endpoint.id}
                orgId={orgId}
                containerId={containerId}
                endpoint={endpoint}
                canManage={canManage}
                onChanged={invalidate}
              />
            ))}
            {endpoints.custom.map(endpoint => (
              <CustomEndpointRow
                key={endpoint.id}
                orgId={orgId}
                containerId={containerId}
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
