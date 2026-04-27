export const BILLING_PROVIDERS = ['stripe', 'mercadopago'] as const

export type BillingProvider = (typeof BILLING_PROVIDERS)[number]

export interface BillingProviderDefinition {
  id: BillingProvider
  label: string
  currencyMode: 'usd' | 'local'
}

export interface BillingProviderOptions {
  billingCountry: string | null
  defaultProvider: BillingProvider
  primaryProvider: BillingProvider
  availableProviders: BillingProvider[]
  providers: BillingProvider[]
}

export const BILLING_PROVIDER_DEFINITIONS: Record<BillingProvider, BillingProviderDefinition> = {
  stripe: {
    id: 'stripe',
    label: 'Stripe',
    currencyMode: 'usd',
  },
  mercadopago: {
    id: 'mercadopago',
    label: 'Mercado Pago',
    currencyMode: 'local',
  },
}

const GLOBAL_PROVIDER_ORDER: BillingProvider[] = ['stripe']

const COUNTRY_PROVIDER_ORDER: Record<string, BillingProvider[]> = {
  AR: ['mercadopago', 'stripe'],
}

export function normalizeBillingCountry(country: string | null | undefined) {
  const normalized = country?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

export function getAvailableBillingProviders(country: string | null | undefined): BillingProvider[] {
  const billingCountry = normalizeBillingCountry(country)
  return COUNTRY_PROVIDER_ORDER[billingCountry ?? ''] ?? GLOBAL_PROVIDER_ORDER
}

export function selectDefaultBillingProvider(country: string | null | undefined): BillingProvider {
  return getAvailableBillingProviders(country)[0] ?? 'stripe'
}

export function selectPrimaryBillingProvider(country: string | null | undefined): BillingProvider {
  return selectDefaultBillingProvider(country)
}

export function getBillingProviderOptions(country: string | null | undefined): BillingProviderOptions {
  const billingCountry = normalizeBillingCountry(country)
  const availableProviders = getAvailableBillingProviders(billingCountry)
  const defaultProvider = selectDefaultBillingProvider(billingCountry)

  return {
    billingCountry,
    defaultProvider,
    primaryProvider: defaultProvider,
    availableProviders,
    providers: availableProviders,
  }
}
