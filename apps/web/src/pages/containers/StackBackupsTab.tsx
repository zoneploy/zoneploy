import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Archive, AlertTriangle, Database, RefreshCw, Trash2 } from 'lucide-react'
import { stacksApi, type StackBackupItem } from '@/api/stacks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { getApiError } from '@/lib/errors'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function BackupRow({
  backup,
  canManage,
  onRestore,
  onDelete,
  isRestoring,
  isDeleting,
}: {
  backup: StackBackupItem
  canManage: boolean
  onRestore: () => void
  onDelete: () => void
  isRestoring: boolean
  isDeleting: boolean
}) {
  const { t } = useTranslation()
  const createdAt = new Date(backup.createdAt)
  const isFailed = backup.status === 'failed'

  return (
    <div className="rounded-xl border border-grey-100 bg-background-paper p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <Archive size={15} className={isFailed ? 'text-red-400' : 'text-primary'} />
            <p className="truncate font-mono text-sm font-semibold text-text-primary">{backup.id}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
              isFailed ? 'bg-red-500/10 text-red-400' : 'bg-success/10 text-success'
            }`}>
              {t(`stacks.backups.status.${backup.status}`)}
            </span>
          </div>

          <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
            <span>{t('stacks.backups.created')}: {createdAt.toLocaleString()}</span>
            <span>{t('stacks.backups.size')}: {formatBytes(backup.sizeBytes)}</span>
            <span>{t('stacks.backups.volumes')}: {backup.volumes.length}</span>
          </div>

          {backup.errorMessage && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {backup.errorMessage}
            </p>
          )}

          {backup.volumes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {backup.volumes.map(volume => (
                <span key={volume.name} className="inline-flex items-center gap-1.5 rounded-full bg-grey-50 px-2.5 py-1 text-xs text-text-secondary">
                  <Database size={11} />
                  <span className="font-mono">{volume.composeName ?? volume.name}</span>
                  <span>{formatBytes(volume.sizeBytes)}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary">{t('stacks.backups.noVolumes')}</p>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isFailed || backup.volumes.length === 0}
              loading={isRestoring}
              onClick={onRestore}
            >
              <RefreshCw size={13} />
              {t('stacks.backups.restore')}
            </Button>
            <Button size="sm" variant="outline" loading={isDeleting} onClick={onDelete} className="text-red-400 hover:text-red-300">
              <Trash2 size={13} />
              {t('common.delete')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function StackBackupsTab({
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
  const [backupToRestore, setBackupToRestore] = useState<StackBackupItem | null>(null)
  const [backupToDelete, setBackupToDelete] = useState<StackBackupItem | null>(null)
  const [settings, setSettings] = useState({
    enabled: false,
    intervalHours: 24,
    retentionCount: 5,
    storageProvider: 'local-vps' as 'local-vps' | 's3-compatible',
    endpoint: '',
    bucket: '',
    region: 'us-east-1',
    prefix: 'zoneploy',
    forcePathStyle: true,
    accessKeyId: '',
    secretAccessKey: '',
  })
  const queryKey = ['stack-backups', orgId, stackId]

  const { data: backups = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => stacksApi.listBackups(orgId, stackId),
    enabled: !!orgId && !!stackId,
  })

  const { data: policy } = useQuery({
    queryKey: ['stack-backup-policy', orgId, stackId],
    queryFn: () => stacksApi.getBackupPolicy(orgId, stackId),
    enabled: !!orgId && !!stackId,
  })

  useEffect(() => {
    if (!policy) return
    setSettings(current => ({
      ...current,
      enabled: policy.enabled,
      intervalHours: policy.intervalHours,
      retentionCount: policy.retentionCount,
      storageProvider: policy.storageProvider,
      endpoint: policy.storageConfig.endpoint,
      bucket: policy.storageConfig.bucket,
      region: policy.storageConfig.region,
      prefix: policy.storageConfig.prefix,
      forcePathStyle: policy.storageConfig.forcePathStyle,
      accessKeyId: '',
      secretAccessKey: '',
    }))
  }, [policy])

  const createBackup = useMutation({
    mutationFn: () => stacksApi.createBackup(orgId, stackId, settings.retentionCount),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  const updatePolicy = useMutation({
    mutationFn: () => stacksApi.updateBackupPolicy(orgId, stackId, {
      enabled: settings.enabled,
      intervalHours: settings.intervalHours,
      retentionCount: settings.retentionCount,
      storageProvider: settings.storageProvider,
      storageConfig: settings.storageProvider === 's3-compatible'
        ? {
            endpoint: settings.endpoint,
            bucket: settings.bucket,
            region: settings.region,
            prefix: settings.prefix,
            forcePathStyle: settings.forcePathStyle,
            ...(settings.accessKeyId ? { accessKeyId: settings.accessKeyId } : {}),
            ...(settings.secretAccessKey ? { secretAccessKey: settings.secretAccessKey } : {}),
          }
        : undefined,
    }),
    onSuccess: () => {
      setSettings(current => ({ ...current, accessKeyId: '', secretAccessKey: '' }))
      queryClient.invalidateQueries({ queryKey: ['stack-backup-policy', orgId, stackId] })
    },
  })

  const restoreBackup = useMutation({
    mutationFn: (backupId: string) => stacksApi.restoreBackup(orgId, stackId, backupId),
    onSuccess: () => {
      setBackupToRestore(null)
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['stack-services', orgId, stackId] })
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId, stackId] })
    },
  })

  const deleteBackup = useMutation({
    mutationFn: (backupId: string) => stacksApi.deleteBackup(orgId, stackId, backupId),
    onSuccess: () => {
      setBackupToDelete(null)
      queryClient.invalidateQueries({ queryKey })
    },
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-sm">{t('stacks.backups.title')}</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">{t('stacks.backups.subtitle')}</p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => createBackup.mutate()} loading={createBackup.isPending}>
                <Archive size={13} />
                {t('stacks.backups.create')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <p>{t('stacks.backups.localStorageNotice')}</p>
          </div>

          {createBackup.error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
              {getApiError(createBackup.error, t)}
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
              {getApiError(error, t)}
            </p>
          )}

          {isLoading ? (
            <LoadingState />
          ) : backups.length === 0 ? (
            <EmptyState icon={Archive} title={t('stacks.backups.empty')} />
          ) : (
            <div className="space-y-3">
              {backups.map(backup => (
                <BackupRow
                  key={backup.id}
                  backup={backup}
                  canManage={canManage}
                  onRestore={() => setBackupToRestore(backup)}
                  onDelete={() => setBackupToDelete(backup)}
                  isRestoring={restoreBackup.isPending && restoreBackup.variables === backup.id}
                  isDeleting={deleteBackup.isPending && deleteBackup.variables === backup.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('stacks.backups.policyTitle')}</CardTitle>
          <p className="mt-1 text-sm text-text-secondary">{t('stacks.backups.policySubtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t('stacks.backups.schedule')}</Label>
              <Select
                value={settings.enabled ? String(settings.intervalHours) : 'off'}
                onChange={(event) => {
                  const value = event.target.value
                  setSettings(current => ({
                    ...current,
                    enabled: value !== 'off',
                    intervalHours: value === 'off' ? current.intervalHours : Number(value),
                  }))
                }}
                disabled={!canManage || updatePolicy.isPending}
              >
                <option value="off">{t('stacks.backups.scheduleOff')}</option>
                <option value="6">{t('stacks.backups.everyHours', { count: 6 })}</option>
                <option value="12">{t('stacks.backups.everyHours', { count: 12 })}</option>
                <option value="24">{t('stacks.backups.everyDays', { count: 1 })}</option>
                <option value="168">{t('stacks.backups.everyDays', { count: 7 })}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('stacks.backups.retention')}</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={settings.retentionCount}
                disabled={!canManage || updatePolicy.isPending}
                onChange={(event) => setSettings(current => ({ ...current, retentionCount: Number(event.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('stacks.backups.storage')}</Label>
              <Select
                value={settings.storageProvider}
                disabled={!canManage || updatePolicy.isPending}
                onChange={(event) => setSettings(current => ({
                  ...current,
                  storageProvider: event.target.value as 'local-vps' | 's3-compatible',
                }))}
              >
                <option value="local-vps">{t('stacks.backups.storageLocal')}</option>
                <option value="s3-compatible">{t('stacks.backups.storageS3')}</option>
              </Select>
            </div>
          </div>

          {settings.storageProvider === 's3-compatible' && (
            <div className="rounded-xl border border-grey-100 bg-grey-25 p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3Endpoint')}</Label>
                  <Input value={settings.endpoint} placeholder="https://s3.amazonaws.com" disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, endpoint: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3Bucket')}</Label>
                  <Input value={settings.bucket} disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, bucket: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3Region')}</Label>
                  <Input value={settings.region} disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, region: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3Prefix')}</Label>
                  <Input value={settings.prefix} disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, prefix: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3AccessKey')}</Label>
                  <Input value={settings.accessKeyId} placeholder={policy?.storageConfig.accessKeyIdConfigured ? t('stacks.backups.secretConfigured') : ''} disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, accessKeyId: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('stacks.backups.s3SecretKey')}</Label>
                  <Input type="password" value={settings.secretAccessKey} placeholder={policy?.storageConfig.secretAccessKeyConfigured ? t('stacks.backups.secretConfigured') : ''} disabled={!canManage || updatePolicy.isPending} onChange={(event) => setSettings(current => ({ ...current, secretAccessKey: event.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={settings.forcePathStyle}
                  disabled={!canManage || updatePolicy.isPending}
                  onChange={(event) => setSettings(current => ({ ...current, forcePathStyle: event.target.checked }))}
                />
                {t('stacks.backups.s3PathStyle')}
              </label>
              <p className="text-xs text-text-secondary">{t('stacks.backups.s3Hint')}</p>
            </div>
          )}

          {policy && (
            <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
              <span>{t('stacks.backups.lastRun')}: {policy.lastRunAt ? new Date(policy.lastRunAt).toLocaleString() : t('common.never')}</span>
              <span>{t('stacks.backups.nextRun')}: {policy.nextRunAt ? new Date(policy.nextRunAt).toLocaleString() : t('common.disabled')}</span>
              <span>{t('stacks.backups.lastStatus')}: {t(`stacks.backups.policyStatus.${policy.lastStatus}`)}</span>
            </div>
          )}

          {(updatePolicy.error || policy?.lastError) && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
              {updatePolicy.error ? getApiError(updatePolicy.error, t) : policy?.lastError}
            </p>
          )}

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => updatePolicy.mutate()} loading={updatePolicy.isPending}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {backupToRestore && (
        <ConfirmDialog
          title={t('stacks.backups.restoreConfirmTitle')}
          message={t('stacks.backups.restoreConfirmMsg', { backupId: backupToRestore.id })}
          confirmLabel={t('stacks.backups.restore')}
          loading={restoreBackup.isPending}
          error={restoreBackup.error ? getApiError(restoreBackup.error, t) : undefined}
          onConfirm={() => restoreBackup.mutate(backupToRestore.id)}
          onCancel={() => setBackupToRestore(null)}
          danger
        />
      )}

      {backupToDelete && (
        <ConfirmDialog
          title={t('stacks.backups.deleteConfirmTitle')}
          message={t('stacks.backups.deleteConfirmMsg', { backupId: backupToDelete.id })}
          confirmLabel={t('common.delete')}
          loading={deleteBackup.isPending}
          error={deleteBackup.error ? getApiError(deleteBackup.error, t) : undefined}
          onConfirm={() => deleteBackup.mutate(backupToDelete.id)}
          onCancel={() => setBackupToDelete(null)}
          danger
        />
      )}
    </div>
  )
}
