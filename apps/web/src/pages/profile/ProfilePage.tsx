import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  User, Lock, Shield, KeyRound, Smartphone,
  CheckCircle2, Copy, Eye, EyeOff, Trash2, Plus, Loader2,
  Monitor, Globe, LogOut,
} from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth'
import { useLogout } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { OtpInput } from '@/components/ui/OtpInput'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingState } from '@/components/ui/spinner'
import { copyTextToClipboard } from '@/lib/clipboard'

// API helpers

const profileApi = {
  updateName: (fullName: string) =>
    apiClient.patch<{ fullName: string }>('/auth/profile', { fullName }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<{ ok: boolean }>('/auth/profile/change-password', { currentPassword, newPassword }),

  setupTotp: () =>
    apiClient.post<{ secret: string; qrDataUrl: string }>('/auth/profile/2fa/totp/setup'),

  verifyTotp: (code: string) =>
    apiClient.post<{ ok: boolean }>('/auth/profile/2fa/totp/verify', { code }),

  disableTotp: (code: string) =>
    apiClient.post<{ ok: boolean }>('/auth/profile/2fa/totp/disable', { code }),

  getStatus: () =>
    apiClient.get<{ totpEnabled: boolean }>('/auth/profile/2fa/status'),

  listPasskeys: () =>
    apiClient.get<PasskeyRow[]>('/auth/profile/passkeys'),

  deletePasskey: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/auth/profile/passkeys/${id}`),

  getRegistrationOptions: (attachment?: 'platform' | 'cross-platform') =>
    apiClient.post<Record<string, unknown>>('/auth/webauthn/register/options', attachment ? { attachment } : undefined),

  verifyRegistration: (response: unknown, deviceName: string) =>
    apiClient.post<{ ok: boolean; passkeyId: string }>('/auth/webauthn/register/verify', { response, deviceName }),
}

type PasskeyRow = {
  id: string
  name: string
  deviceType: string | null
  backedUp: boolean
  createdAt: string
}

// Inline error / success

function Alert({ type, message }: { type: 'error' | 'success'; message: string }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-sm ${
      type === 'error'
        ? 'bg-destructive/8 border border-destructive/20 text-destructive'
        : 'bg-emerald-500/8 border border-emerald-500/20 text-emerald-600'
    }`}>
      {message}
    </div>
  )
}

// Section: personal information

function PersonalInfoSection() {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)
  const [name, setName] = useState(session?.user.fullName ?? '')
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  const update = useMutation({
    mutationFn: () => profileApi.updateName(name),
    onSuccess: (data) => {
      if (session) {
        setSession(session.accessToken, {
          ...session,
          user: { ...session.user, fullName: data.fullName },
        })
      }
      setFeedback({ type: 'success', msg: t('profile.savedOk') })
      setTimeout(() => setFeedback(null), 3000)
    },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <User size={16} className="text-primary" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('profile.personalInfo')}</p>
            <p className="text-xs text-text-secondary">{t('profile.personalInfoSubtitle')}</p>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('auth.fullName')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('auth.email')}</Label>
            <Input value={session?.user.email ?? ''} disabled />
          </div>
        </div>
        {feedback && <Alert type={feedback.type} message={feedback.msg} />}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => update.mutate()}
            loading={update.isPending}
            disabled={name === session?.user.fullName || !name.trim()}
          >
            {t('common.saveChanges')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// Section: password change

function PasswordSection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  const change = useMutation({
    mutationFn: () => profileApi.changePassword(current, next),
    onSuccess: () => {
      setCurrent(''); setNext(''); setConfirm('')
      setFeedback({ type: 'success', msg: t('profile.passwordChanged') })
      setTimeout(() => setFeedback(null), 3000)
    },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const mismatch = next && confirm && next !== confirm
  const canSubmit = !!current && !!next && next === confirm && next.length >= 8
  const passwordHint = next && next.length < 8 ? t('auth.passwordMinLength') : null

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Lock size={16} className="text-primary" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('profile.password')}</p>
            <p className="text-xs text-text-secondary">{t('profile.passwordSubtitle')}</p>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label>{t('profile.currentPassword')}</Label>
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                value={current}
                onChange={e => setCurrent(e.target.value)}
                autoComplete="current-password"
                className="h-12 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="hidden lg:block" aria-hidden="true" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('profile.newPassword')}</Label>
            <div className="relative">
              <Input
                type={showNext ? 'text' : 'password'}
                value={next}
                onChange={e => setNext(e.target.value)}
                autoComplete="new-password"
                className={passwordHint ? 'h-12 pr-10 border-destructive' : 'h-12 pr-10'}
              />
              <button
                type="button"
                onClick={() => setShowNext(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                {showNext ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {passwordHint && <p className="text-xs text-destructive">{passwordHint}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t('profile.confirmPassword')}</Label>
            <Input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={mismatch ? 'h-12 border-destructive' : 'h-12'}
            />
            {mismatch && <p className="text-xs text-destructive">{t('profile.passwordMismatch')}</p>}
          </div>
        </div>

        {feedback && <Alert type={feedback.type} message={feedback.msg} />}

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-text-secondary">
            {t('profile.passwordSubtitle')}
          </div>
          <Button
            size="sm"
            onClick={() => change.mutate()}
            loading={change.isPending}
            disabled={!canSubmit}
            className="w-full sm:w-auto"
          >
            {t('profile.changePassword')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// Section: TOTP 2FA

function TotpSection({ enabled, onToggle }: { enabled: boolean; onToggle: (enabled: boolean) => void }) {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState<'setup' | 'disableConfirm' | 'disable' | null>(null)
  const [qrData, setQrData] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)

  const closeModal = () => { setModalOpen(null); setCode(''); setQrData(null); setFeedback(null) }

  const setup = useMutation({
    mutationFn: profileApi.setupTotp,
    onSuccess: (data) => { setQrData(data) },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const verify = useMutation({
    mutationFn: () => profileApi.verifyTotp(code),
    onSuccess: () => { closeModal(); onToggle(true) },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const disable = useMutation({
    mutationFn: () => profileApi.disableTotp(code),
    onSuccess: () => { closeModal(); onToggle(false) },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const copySecret = async () => {
    if (qrData?.secret) {
      if (!(await copyTextToClipboard(qrData.secret))) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const openSetup = () => {
    setFeedback(null)
    setModalOpen('setup')
    setup.mutate()
  }

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Smartphone size={16} className="text-primary" strokeWidth={1.6} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-text-primary">{t('profile.totp')}</p>
                {enabled && (
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    {t('common.active')}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary">{t('profile.totpSubtitle')}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={enabled ? () => { setFeedback(null); setModalOpen('disableConfirm') } : openSetup}
            loading={setup.isPending && modalOpen === 'setup'}
          >
            {enabled ? t('profile.totpDisableBtn') : t('profile.totpSetupBtn')}
          </Button>
        </div>
      </Card>

      {/* Setup modal. */}
      <Dialog
        open={modalOpen === 'setup'}
        onClose={closeModal}
        title={t('profile.totpSetupTitle')}
        description={t('profile.totpScanQr')}
      >
        <div className="space-y-4">
          {setup.isPending && (
            <div className="flex justify-center py-6">
              <Loader2 size={24} className="animate-spin text-text-secondary" />
            </div>
          )}
          {qrData && (
            <>
              <div className="flex justify-center">
                <img src={qrData.qrDataUrl} alt="QR TOTP" className="h-56 w-56 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-text-secondary">{t('profile.totpManualCode')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 font-mono text-text-primary break-all">
                    {qrData.secret}
                  </code>
                  <button onClick={copySecret} className="h-9 w-9 flex items-center justify-center rounded-lg border border-border hover:bg-grey-50 transition-colors text-text-secondary shrink-0">
                    {copied ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('profile.totpEnterCode')}</Label>
                <OtpInput value={code} onChange={setCode} />
              </div>
            </>
          )}
          {feedback && <Alert type={feedback.type} message={feedback.msg} />}
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="secondary" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={() => verify.mutate()} loading={verify.isPending} disabled={code.length !== 6 || !qrData}>
              {t('profile.totpVerifyBtn')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Modal: confirmar desactivar */}
      <Dialog
        open={modalOpen === 'disableConfirm'}
        onClose={closeModal}
        title={t('profile.totpDisableTitle')}
        description={t('profile.totpDisableConfirmDesc')}
        className="max-w-sm"
      >
        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="secondary" onClick={closeModal}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => setModalOpen('disable')}>
            {t('profile.totpDisableBtn')}
          </Button>
        </div>
      </Dialog>

      {/* Modal: disable and verify code. */}
      <Dialog
        open={modalOpen === 'disable'}
        onClose={closeModal}
        title={t('profile.totpDisableCodeTitle')}
        description={t('profile.totpDisableConfirm')}
        className="max-w-sm"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('profile.totpEnterCode')}</Label>
            <OtpInput value={code} onChange={setCode} />
          </div>
          {feedback && <Alert type={feedback.type} message={feedback.msg} />}
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="secondary" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button size="sm" variant="danger" onClick={() => disable.mutate()} loading={disable.isPending} disabled={code.length !== 6}>
              {t('profile.totpDisableBtn')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

// Section: security key (WebAuthn)

type AttachmentType = 'cross-platform' | 'platform'

function PasskeySection({ onAdded }: { onAdded?: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [modalStep, setModalStep] = useState<null | 'type' | 'name'>(null)
  const [attachment, setAttachment] = useState<AttachmentType>('cross-platform')
  const [keyName, setKeyName] = useState('')
  const [registering, setRegistering] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: passkeys = [], isLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: profileApi.listPasskeys,
  })

  const remove = useMutation({
    mutationFn: (id: string) => profileApi.deletePasskey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  })

  const closeModal = () => { setModalStep(null); setKeyName(''); setFeedback(null) }

  const selectType = (type: AttachmentType) => {
    setAttachment(type)
    setKeyName(type === 'cross-platform' ? 'YubiKey' : t('profile.passkeyThisDevice'))
    setModalStep('name')
  }

  const registerPasskey = async () => {
    if (!keyName.trim()) return
    setRegistering(true)
    setFeedback(null)
    try {
      const options = await profileApi.getRegistrationOptions(attachment)
      const response = await startRegistration({ optionsJSON: options as any })
      await profileApi.verifyRegistration(response, keyName.trim())
      queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      closeModal()
      onAdded?.()
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') {
        setFeedback({ type: 'error', msg: e?.message ?? t('profile.passkeyError') })
      }
    } finally {
      setRegistering(false)
    }
  }

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <KeyRound size={16} className="text-primary" strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('profile.passkey')}</p>
              <p className="text-xs text-text-secondary">{t('profile.passkeySubtitle')}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { setFeedback(null); setModalStep('type') }}>
            <Plus size={13} />{t('profile.passkeyAdd')}
          </Button>
        </div>

        <div className="border-t border-border">
          {isLoading ? (
            <LoadingState />
          ) : passkeys.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <KeyRound size={20} className="text-text-disabled mx-auto mb-2" strokeWidth={1.4} />
              <p className="text-sm text-text-secondary">{t('profile.passkeyEmpty')}</p>
            </div>
          ) : (
            <table className="w-full">
              <tbody className="divide-y divide-border">
                {passkeys.map(pk => (
                  <tr key={pk.id} className="hover:bg-grey-50/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          {pk.deviceType === 'platform'
                            ? <Smartphone size={14} className="text-primary" strokeWidth={1.6} />
                            : <KeyRound size={14} className="text-primary" strokeWidth={1.6} />
                          }
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">{pk.name}</p>
                          <p className="text-xs text-text-secondary">
                            {pk.backedUp ? t('profile.passkeyBackedUp') : t('profile.passkeyLocal')}
                            {' · '}{new Date(pk.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 w-12">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-text-disabled hover:text-destructive"
                          onClick={() => setConfirmDeleteId(pk.id)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Type picker modal. */}
      <Dialog open={modalStep === 'type'} onClose={closeModal} title={t('profile.passkeyAdd')} description={t('profile.passkeyChooseType')}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <button
              onClick={() => selectType('cross-platform')}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <KeyRound size={14} className="text-text-secondary group-hover:text-primary" />
                <span className="text-xs font-semibold text-text-primary">{t('profile.passkeyTypeExternal')}</span>
              </div>
              <p className="text-[11px] text-text-secondary">{t('profile.passkeyTypeExternalHint')}</p>
            </button>
            <button
              onClick={() => selectType('platform')}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <Smartphone size={14} className="text-text-secondary group-hover:text-primary" />
                <span className="text-xs font-semibold text-text-primary">{t('profile.passkeyTypeDevice')}</span>
              </div>
              <p className="text-[11px] text-text-secondary">{t('profile.passkeyTypeDeviceHint')}</p>
            </button>
          </div>
        </div>
      </Dialog>

      {/* Modal: confirm security key deletion. */}
      <Dialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title={t('profile.passkeyDeleteTitle')}
        description={t('profile.passkeyDeleteConfirm')}
        className="max-w-sm"
      >
        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => { remove.mutate(confirmDeleteId!); setConfirmDeleteId(null) }} loading={remove.isPending}>
            {t('common.delete')}
          </Button>
        </div>
      </Dialog>

      {/* Modal: nombre y registrar */}
      <Dialog open={modalStep === 'name'} onClose={closeModal} title={t('profile.passkeyNameTitle')} description={t('profile.passkeyNameHint')}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('profile.passkeyNameLabel')}</Label>
            <Input
              autoFocus
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder={t('profile.passkeyNamePlaceholder')}
              onKeyDown={e => { if (e.key === 'Enter') registerPasskey(); if (e.key === 'Escape') closeModal() }}
            />
          </div>
          {feedback && <Alert type={feedback.type} message={feedback.msg} />}
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="secondary" onClick={closeModal} disabled={registering}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={registerPasskey} loading={registering} disabled={!keyName.trim()}>
              {t('profile.passkeyRegisterBtn')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

// Section: active sessions

type SessionRow = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastUsedAt: string
  createdAt: string
  isCurrent: boolean
}

function parseUserAgent(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: 'Navegador desconocido', os: '' }
  let browser = 'Navegador'
  if (ua.includes('Edg/') || ua.includes('EdgA/')) browser = 'Edge'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'
  let os = ''
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('Mac OS')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  return { browser, os }
}

function formatRelative(dateStr: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return t('sessions.justNow')
  if (minutes < 60) return t('sessions.minutesAgo').replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('sessions.hoursAgo').replace('{n}', String(hours))
  const days = Math.floor(hours / 24)
  return t('sessions.daysAgo').replace('{n}', String(days))
}

const sessionsApi = {
  list: () => apiClient.get<SessionRow[]>('/auth/sessions'),
  revoke: (id: string) => apiClient.delete<{ ok: boolean }>(`/auth/sessions/${id}`),
  revokeOthers: () => apiClient.delete<{ ok: boolean }>('/auth/sessions'),
}

function SessionsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const logout = useLogout()
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => sessionsApi.revoke(id),
    onSuccess: (_data, id) => {
      const session = sessions.find(s => s.id === id)
      if (session?.isCurrent) { logout(); return }
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const revokeOthers = useMutation({
    mutationFn: sessionsApi.revokeOthers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setFeedback({ type: 'success', msg: t('sessions.othersRevoked') })
      setTimeout(() => setFeedback(null), 3000)
    },
    onError: (e) => setFeedback({ type: 'error', msg: (e as Error).message }),
  })

  const otherSessions = sessions.filter(s => !s.isCurrent)

  return (
    <>
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Monitor size={16} className="text-primary" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('sessions.title')}</p>
            <p className="text-xs text-text-secondary">{t('sessions.count', { count: sessions.length })}</p>
          </div>
        </div>
        {otherSessions.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => revokeOthers.mutate()}
            loading={revokeOthers.isPending}
          >
            <LogOut size={13} />{t('sessions.revokeAll')}
          </Button>
        )}
      </div>

      <div className="border-t border-border">
        {isLoading ? (
          <LoadingState />
        ) : sessions.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <Globe size={20} className="text-text-disabled mx-auto mb-2" strokeWidth={1.4} />
            <p className="text-sm text-text-secondary">{t('sessions.empty')}</p>
          </div>
        ) : (
          <table className="w-full">
            <tbody className="divide-y divide-border">
              {sessions.map(s => {
                const { browser, os } = parseUserAgent(s.userAgent)
                return (
                  <tr key={s.id} className="hover:bg-grey-50/40 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Globe size={14} className="text-primary" strokeWidth={1.6} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-text-primary">
                              {browser}{os ? ` · ${os}` : ''}
                            </p>
                            {s.isCurrent && (
                              <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                {t('sessions.current')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-secondary mt-0.5">
                            {s.ipAddress && <span>{s.ipAddress} · </span>}
                            {t('sessions.lastUsed')} {formatRelative(s.lastUsedAt, t)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 w-12">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-text-disabled hover:text-destructive"
                          title={s.isCurrent ? t('sessions.logoutThis') : t('sessions.revoke')}
                          loading={revoke.isPending && revoke.variables === s.id}
                          onClick={() => s.isCurrent ? setConfirmLogout(true) : revoke.mutate(s.id)}
                        >
                          {s.isCurrent ? <LogOut size={13} /> : <Trash2 size={13} />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {feedback && (
          <div className="px-5 pb-4">
            <Alert type={feedback.type} message={feedback.msg} />
          </div>
        )}
      </div>
    </Card>

    <Dialog
      open={confirmLogout}
      onClose={() => setConfirmLogout(false)}
      title={t('sessions.logoutConfirmTitle')}
      description={t('sessions.logoutConfirmDesc')}
      className="max-w-sm"
    >
      <div className="flex gap-2 justify-end pt-1">
        <Button size="sm" variant="secondary" onClick={() => setConfirmLogout(false)}>{t('common.cancel')}</Button>
        <Button
          size="sm"
          variant="danger"
          loading={revoke.isPending}
          onClick={() => { const curr = sessions.find(s => s.isCurrent); if (curr) revoke.mutate(curr.id); setConfirmLogout(false) }}
        >
          {t('sessions.logoutThis')}
        </Button>
      </div>
    </Dialog>
    </>
  )
}

// Pages

export function ProfilePage() {
  const { t } = useTranslation()
  return (
    <div className="w-full space-y-6">
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />
      <PersonalInfoSection />
    </div>
  )
}

export function SecurityPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)
  const accessToken = useAuthStore(s => s.accessToken)

  const { data: twoFaStatus } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: profileApi.getStatus,
  })

  const { data: passkeys = [] } = useQuery({
    queryKey: ['passkeys'],
    queryFn: profileApi.listPasskeys,
  })

  const totpEnabled = twoFaStatus?.totpEnabled ?? false
  const needsOrgMfaSetup = !!(
    session?.org?.require2fa &&
    !totpEnabled &&
    passkeys.length === 0 &&
    session?.org?.role !== 'owner'
  )

  const handleTotpToggle = (enabled: boolean) => {
    queryClient.invalidateQueries({ queryKey: ['2fa-status'] })
    if (session && accessToken) {
      setSession(accessToken, { ...session, user: { ...session.user, totpEnabled: enabled } })
    }
    if (needsOrgMfaSetup && enabled) navigate('/projects')
  }

  const handlePasskeyAdded = () => {
    if (needsOrgMfaSetup) navigate('/projects')
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader title={t('topbar.security')} subtitle={t('profile.securitySubtitle')} />

      {/* Banner org 2FA */}
      {needsOrgMfaSetup && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 flex items-start gap-3">
          <Shield size={16} className="text-warning shrink-0 mt-0.5" strokeWidth={2} />
          <p className="text-sm text-warning leading-relaxed">{t('profile.orgRequires2fa')}</p>
        </div>
      )}

      <PasswordSection />
      <TotpSection enabled={totpEnabled} onToggle={handleTotpToggle} />
      <PasskeySection onAdded={handlePasskeyAdded} />
      <SessionsSection />
    </div>
  )
}
