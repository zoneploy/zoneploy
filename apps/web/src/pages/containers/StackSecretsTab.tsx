import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { stacksApi, type StackSecretKey } from '@/api/stacks'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/spinner'

function AddStackSecretForm({
  orgId,
  stackId,
  onClose,
}: {
  orgId: string
  stackId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  const upsert = useMutation({
    mutationFn: () => stacksApi.upsertSecret(orgId, stackId, key.toUpperCase(), value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stack-secrets', stackId] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        upsert.mutate()
      }}
      className="space-y-4"
      autoComplete="off"
    >
      {upsert.error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {(upsert.error as Error).message}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('secrets.key')}</Label>
        <Input
          value={key}
          onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
          placeholder={t('secrets.keyPlaceholder')}
          className="font-mono"
          required
        />
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
        <p className="text-xs text-text-secondary">{t('stacks.sharedSecretsHint')}</p>
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

function StackSecretRow({
  secret,
  orgId,
  stackId,
  canManage,
}: {
  secret: StackSecretKey
  orgId: string
  stackId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const remove = useMutation({
    mutationFn: () => stacksApi.deleteSecret(orgId, stackId, secret.key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stack-secrets', stackId] }),
  })

  return (
    <>
      <div className="flex items-center justify-between border-b border-grey-100 py-3 last:border-0">
        <div className="flex items-center gap-3">
          <KeyRound size={14} className="shrink-0 text-text-secondary" />
          <div>
            <p className="font-mono text-sm font-medium text-text-primary">{secret.key}</p>
            <p className="text-xs text-text-secondary">{new Date(secret.updatedAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded border border-grey-100 bg-grey-25 px-2 py-0.5 font-mono text-xs text-text-secondary">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-grey-100 bg-background p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-500/10 p-2 shrink-0">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">{t('secrets.deleteTitle')}</p>
                <p className="mt-1 font-mono text-xs text-text-secondary">{secret.key}</p>
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

export function StackSecretsTab({
  orgId,
  stackId,
  canManage,
}: {
  orgId: string
  stackId: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)

  const { data: secretsList = [], isLoading } = useQuery({
    queryKey: ['stack-secrets', stackId],
    queryFn: () => stacksApi.listSecrets(orgId, stackId),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-secondary">{t('secrets.count', { count: secretsList.length })}</p>
          <p className="mt-0.5 text-xs text-text-secondary">{t('stacks.sharedSecretsHint')}</p>
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
          {secretsList.map(secret => (
            <StackSecretRow
              key={secret.id}
              secret={secret}
              orgId={orgId}
              stackId={stackId}
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
        <AddStackSecretForm orgId={orgId} stackId={stackId} onClose={() => setShowAdd(false)} />
      </Dialog>
    </div>
  )
}
