import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, KeyRound, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from 'react-i18next'
import { secretsApi, type SecretKey } from '@/api/secrets'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'

// Add secret form

function AddSecretForm({
  orgId,
  containerId,
  onClose,
}: {
  orgId: string
  containerId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  const upsert = useMutation({
    mutationFn: () => secretsApi.upsert(orgId, containerId, key.toUpperCase(), value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', containerId] })
      onClose()
    },
  })

  const handleKeyChange = (v: string) => {
    // Auto-format to uppercase and underscores.
    setKey(v.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        upsert.mutate()
      }}
      className="space-y-4"
      autoComplete="off"
    >
      {/* Trap fields prevent the browser from offering credential autocomplete. */}
      <input type="text" name="username" style={{ display: 'none' }} readOnly tabIndex={-1} aria-hidden="true" />
      <input type="password" name="password" style={{ display: 'none' }} readOnly tabIndex={-1} aria-hidden="true" />
      {upsert.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {(upsert.error as Error).message}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('secrets.key')}</Label>
        <Input
          value={key}
          onChange={e => handleKeyChange(e.target.value)}
          placeholder={t('secrets.keyPlaceholder')}
          className="font-mono"
          autoComplete="new-password"
          name="secret-key"
          required
        />
        <p className="text-xs text-text-secondary">{t('secrets.keyPlaceholder')}</p>
      </div>

      <div className="space-y-1.5">
        <Label>{t('secrets.value')}</Label>
        <div className="relative">
          <Input
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={t('secrets.valuePlaceholder')}
            className="pr-9 font-mono"
            autoComplete="new-password"
            name="secret-value"
            required
          />
          <button
            type="button"
            onClick={() => setShowValue(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
          >
            {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-text-secondary">{t('secrets.valueHint')}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={upsert.isPending} disabled={!key || !value}>
          <KeyRound size={14} />
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}

// Secret row

function SecretRow({
  secret,
  orgId,
  containerId,
  canManage,
}: {
  secret: SecretKey
  orgId: string
  containerId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const remove = useMutation({
    mutationFn: () => secretsApi.delete(orgId, containerId, secret.key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secrets', containerId] }),
  })

  return (
    <>
      <div className="flex items-center justify-between py-3 border-b border-grey-100 last:border-0">
        <div className="flex items-center gap-3">
          <KeyRound size={14} className="text-text-secondary flex-shrink-0" />
          <div>
            <p className="text-sm font-mono font-medium text-text-primary">{secret.key}</p>
            <p className="text-xs text-text-secondary">
              {new Date(secret.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-secondary bg-grey-25 border border-grey-100 rounded px-2 py-0.5">
            ••••••••
          </span>
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirmDelete(true)}
              loading={remove.isPending}
              className="text-text-secondary hover:text-red-400"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-sm bg-background rounded-xl border border-grey-100 shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-500/10 p-2 shrink-0">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">{t('secrets.deleteTitle')}</p>
                <p className="text-xs text-text-secondary mt-1 font-mono">{secret.key}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={() => { setConfirmDelete(false); remove.mutate() }} loading={remove.isPending}>{t('common.delete')}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Main tab

export function SecretsTab({
  orgId,
  containerId,
  canManage,
}: {
  orgId: string
  containerId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)

  const { data: secretsList = [], isLoading } = useQuery({
    queryKey: ['secrets', containerId],
    queryFn: () => secretsApi.list(orgId, containerId),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            {t('secrets.count', { count: secretsList.length })}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">{t('secrets.envHint')}</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={12} />
            {t('secrets.add')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState className="py-4" />
      ) : secretsList.length === 0 ? (
        <div className="rounded-xl border border-grey-100 bg-background-paper">
          <EmptyState
            icon={KeyRound}
            title={t('secrets.empty')}
            action={canManage ? { label: t('secrets.addFirst'), onClick: () => setShowAdd(true), icon: <Plus size={13} /> } : undefined}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-grey-100 bg-background-paper px-4">
          {secretsList.map(s => (
            <SecretRow
              key={s.id}
              secret={s}
              orgId={orgId}
              containerId={containerId}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <Dialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={t('secrets.dialogTitle')}
        description={t('secrets.dialogSubtitle')}
      >
        <AddSecretForm
          orgId={orgId}
          containerId={containerId}
          onClose={() => setShowAdd(false)}
        />
      </Dialog>
    </div>
  )
}
