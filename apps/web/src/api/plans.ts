import { apiClient } from '@/lib/api-client'

export interface Plan {
  id: string
  name: string
  slug: string
  features: string[]
  maxServers: number
  maxDeployments: number
  maxSubdomains: number
  maxCustomDomains: number
  maxInstalledAddOns: number
  priceMonthlyUsd: string
  sortOrder: number
}

export interface Subscription {
  id: string
  status: string
  billingProvider: 'stripe' | 'mercadopago' | null
  externalCustomerId: string | null
  externalSubscriptionId: string | null
  externalPriceId: string | null
  externalStatus: string | null
  paymentFailureAt: string | null
  gracePeriodStartedAt: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  planId: string
  planName: string
  planSlug: string
  maxServers: number
  maxDeployments: number
  maxSubdomains: number
  maxCustomDomains: number
  maxInstalledAddOns: number
  priceMonthlyUsd: string
  usage: {
    servers: number
    deployments: number
    subdomains: number
    customDomains: number
    installedAddOns: number
  }
  billingOptions: BillingProviderOptions
}

export interface BillingProviderOptions {
  billingCountry: string | null
  defaultProvider: 'stripe' | 'mercadopago'
  primaryProvider: 'stripe' | 'mercadopago'
  availableProviders: Array<'stripe' | 'mercadopago'>
  providers: Array<'stripe' | 'mercadopago'>
}

export interface BillingCheckoutResponse {
  action: 'redirect' | 'updated'
  provider: 'stripe' | 'mercadopago' | null
  checkoutUrl: string | null
}

export const plansApi = {
  list: () =>
    apiClient.get<Plan[]>('/plans'),

  getSubscription: (orgId: string) =>
    apiClient.get<Subscription>(`/organizations/${orgId}/subscription`),

  getBillingOptions: (orgId: string) =>
    apiClient.get<BillingProviderOptions>(`/organizations/${orgId}/subscription/billing-options`),

  createCheckout: (orgId: string, planId: string, provider?: 'stripe' | 'mercadopago') =>
    apiClient.post<BillingCheckoutResponse>(`/organizations/${orgId}/subscription/checkout`, { planId, provider }),

  upgrade: (orgId: string, planId: string) =>
    apiClient.post<Subscription>(`/organizations/${orgId}/subscription/upgrade`, { planId }),
}
