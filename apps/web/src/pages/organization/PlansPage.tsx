import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Server, Box, Globe, Puzzle, Zap, Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { plansApi, type Plan } from '@/api/plans'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { Dialog } from '@/components/ui/dialog'
import { getApiError } from '@/lib/errors'

type BillingProvider = 'stripe' | 'mercadopago'

const SUBSCRIPTION_CHANGES_ENABLED = false

function usagePercent(used: number, max: number) {
  if (max === -1) return 0
  return Math.min(100, Math.round((used / max) * 100))
}

function UsageBar({
  label,
  used,
  max,
  icon: Icon,
}: {
  label: string
  used: number
  max: number
  icon: React.ElementType
}) {
  const pct = usagePercent(used, max)
  const isUnlimited = max === -1
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-primary'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <Icon size={11} />
          {label}
        </span>
        <span className="font-mono">
          {used} / {isUnlimited ? '∞' : max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-grey-100">
        {!isUnlimited && (
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${pct}%` }}
          />
        )}
        {isUnlimited && <div className="h-full w-full rounded-full bg-primary/30" />}
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  isCurrent,
  isOwner,
  changesEnabled,
  onSelect,
  loading,
}: {
  plan: Plan
  isCurrent: boolean
  isOwner: boolean
  changesEnabled: boolean
  onSelect: (plan: Plan) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const price = parseFloat(plan.priceMonthlyUsd)
  const translatedFeatures = t(`plans.features.${plan.slug}`, { returnObjects: true }) as unknown
  const features = Array.isArray(translatedFeatures) ? translatedFeatures as string[] : plan.features ?? []
  const isEnterprise = plan.slug === 'enterprise'

  return (
    <div
      className={`relative flex flex-col rounded-xl border p-5 transition-colors ${
        isCurrent
          ? 'border-primary bg-primary/5'
          : 'border-grey-100 bg-background-paper hover:border-grey-200'
      }`}
    >
      {isCurrent && (
        <span className="absolute -top-3 left-4 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-white">
          {t('plans.currentPlan')}
        </span>
      )}

      <div className="mb-4">
        <h3 className="text-base font-semibold text-text-primary">{plan.name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          {price === 0 ? (
            <span className="text-2xl font-bold text-text-primary">{t('plans.free')}</span>
          ) : (
            <>
              <span className="text-2xl font-bold text-text-primary">${price}</span>
              <span className="text-sm text-text-secondary">{t('common.perMonth')}</span>
            </>
          )}
        </div>
      </div>

      <ul className="mb-5 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
            <CheckCircle size={13} className="mt-0.5 flex-shrink-0 text-primary" />
            {feature}
          </li>
        ))}
      </ul>

      {isOwner && !isCurrent && (
        <Button
          variant={isEnterprise ? 'default' : 'secondary'}
          className="w-full"
          onClick={() => {
            if (changesEnabled) onSelect(plan)
          }}
          loading={loading}
          disabled={!changesEnabled || loading}
        >
          {!changesEnabled ? (
            t('plans.prelaunchButton')
          ) : price > 0 ? (
            <>
              <Zap size={13} />
              {t('plans.changeTo', { plan: plan.name })}
            </>
          ) : (
            t('plans.downgradeTo', { plan: plan.name })
          )}
        </Button>
      )}

      {isCurrent && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-primary">
          <CheckCircle size={13} />
          {t('common.current')}
        </div>
      )}
    </div>
  )
}

function ConfirmUpgradeDialog({
  plan,
  providers,
  selectedProvider,
  onProviderChange,
  onConfirm,
  onClose,
  loading,
  error,
}: {
  plan: Plan | null
  providers: BillingProvider[]
  selectedProvider: BillingProvider
  onProviderChange: (provider: BillingProvider) => void
  onConfirm: () => void
  onClose: () => void
  loading: boolean
  error: string | null
}) {
  const { t } = useTranslation()

  if (!plan) return null

  const price = parseFloat(plan.priceMonthlyUsd)
  const requiresPayment = price > 0
  const providerLabels: Record<BillingProvider, string> = {
    stripe: 'Stripe',
    mercadopago: 'Mercado Pago',
  }

  return (
    <Dialog
      open={!!plan}
      onClose={onClose}
      title={t('plans.changeDialogTitle', { plan: plan.name })}
      description={
        price === 0
          ? t('plans.downgradeWarning')
          : t('plans.upgradeInfo', { plan: plan.name })
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-1 rounded-lg border border-grey-100 bg-grey-25 p-3 text-sm text-text-secondary">
          <p>• <strong>{t('plans.maxServers')}</strong> {plan.maxServers === -1 ? t('common.unlimited') : plan.maxServers}</p>
          <p>• <strong>{t('plans.maxDeployments')}</strong> {plan.maxDeployments === -1 ? t('common.unlimited') : plan.maxDeployments}</p>
          <p>• <strong>{t('plans.maxSubdomains')}</strong> {plan.maxSubdomains === -1 ? t('common.unlimited') : plan.maxSubdomains}</p>
          <p>• <strong>{t('plans.maxInstalledAddOns')}</strong> {plan.maxInstalledAddOns === -1 ? t('common.unlimited') : plan.maxInstalledAddOns}</p>
        </div>

        <p className="text-xs text-text-secondary">{t('plans.limitWarning')}</p>

        {requiresPayment && providers.length > 1 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Payment method</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {providers.map(provider => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => onProviderChange(provider)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedProvider === provider
                      ? 'border-primary bg-primary/10 text-text-primary'
                      : 'border-grey-100 bg-grey-25 text-text-secondary hover:border-grey-200'
                  }`}
                >
                  {providerLabels[provider]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            {t('plans.confirmChange')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function PlansPage() {
  const { t } = useTranslation()
  const session = useAuthStore((state) => state.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const isOwner = can('billing:manage')
  const queryClient = useQueryClient()
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<BillingProvider>('stripe')
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const { data: plans = [], isLoading: loadingPlans } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.list(),
  })

  const { data: subscription, isLoading: loadingSub } = useQuery({
    queryKey: ['subscription', orgId],
    queryFn: () => plansApi.getSubscription(orgId),
    enabled: !!orgId,
  })

  const checkout = useMutation({
    mutationFn: () => plansApi.createCheckout(orgId, selectedPlan!.id, parseFloat(selectedPlan!.priceMonthlyUsd) > 0 ? selectedProvider : undefined),
    onSuccess: (result) => {
      if (result.action === 'redirect' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['subscription', orgId] })
      queryClient.invalidateQueries({ queryKey: ['org', orgId] })
      setSelectedPlan(null)
      setUpgradeError(null)
    },
    onError: (err: unknown) => setUpgradeError(getApiError(err, t)),
  })

  const isLoading = loadingPlans || loadingSub

  return (
    <div className="w-full space-y-6">
      <PageHeader title={t('plans.title')} subtitle={t('plans.subtitle')} />

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
        <p className="text-sm font-semibold text-amber-600">{t('plans.prelaunchTitle')}</p>
        <p className="mt-1 text-sm text-text-secondary">{t('plans.prelaunchMessage')}</p>
      </div>

      {subscription && (
        <div className="space-y-4 rounded-xl border border-grey-100 bg-background-paper p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">
              {t('plans.currentUsage', { plan: subscription.planName })}
            </p>
            <span className="font-mono text-xs text-text-secondary">
              ${parseFloat(subscription.priceMonthlyUsd).toFixed(2)}
              {t('common.perMonth')}
            </span>
          </div>
          <div className="space-y-3">
            <UsageBar
              label={t('dashboard.servers')}
              used={subscription.usage.servers}
              max={subscription.maxServers}
              icon={Server}
            />
            <UsageBar
              label={t('dashboard.deployments')}
              used={subscription.usage.deployments}
              max={subscription.maxDeployments}
              icon={Box}
            />
            <UsageBar
              label={t('plans.maxSubdomains')}
              used={subscription.usage.subdomains}
              max={subscription.maxSubdomains}
              icon={Globe}
            />
            <UsageBar
              label={t('plans.maxInstalledAddOns')}
              used={subscription.usage.installedAddOns}
              max={subscription.maxInstalledAddOns}
              icon={Puzzle}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader size={24} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === subscription?.planId}
              isOwner={isOwner}
              changesEnabled={SUBSCRIPTION_CHANGES_ENABLED}
              onSelect={(selected) => {
                setSelectedPlan(selected)
                setSelectedProvider(subscription?.billingOptions.defaultProvider ?? 'stripe')
                setUpgradeError(null)
              }}
              loading={checkout.isPending && selectedPlan?.id === plan.id}
            />
          ))}
        </div>
      )}

      {!isOwner && (
        <p className="text-center text-xs text-text-secondary">{t('plans.onlyOwner')}</p>
      )}

      <ConfirmUpgradeDialog
        plan={selectedPlan}
        providers={(subscription?.billingOptions.availableProviders ?? ['stripe']) as BillingProvider[]}
        selectedProvider={selectedProvider}
        onProviderChange={setSelectedProvider}
        onConfirm={() => checkout.mutate()}
        onClose={() => {
          setSelectedPlan(null)
          setUpgradeError(null)
        }}
        loading={checkout.isPending}
        error={upgradeError}
      />
    </div>
  )
}
