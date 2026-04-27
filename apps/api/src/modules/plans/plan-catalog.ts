export interface PlanCatalogEntry {
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

export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    name: 'Free',
    slug: 'free',
    features: [
      'Single self-hosted instance',
      'Unlimited local containers and stacks',
      'Unlimited custom domains',
      'Local private registry',
    ],
    maxServers: -1,
    maxDeployments: -1,
    maxSubdomains: -1,
    maxCustomDomains: -1,
    maxInstalledAddOns: -1,
    priceMonthlyUsd: '0.00',
    sortOrder: 0,
  },
  {
    name: 'Starter',
    slug: 'starter',
    features: [
      '2 servidores remotos conectados',
      '10 deployments entre containers y stacks',
      '10 subdominios zoneploy.app',
      '2 add-ons instalados',
    ],
    maxServers: 2,
    maxDeployments: 10,
    maxSubdomains: 10,
    maxCustomDomains: -1,
    maxInstalledAddOns: 2,
    priceMonthlyUsd: '7.00',
    sortOrder: 1,
  },
  {
    name: 'Pro',
    slug: 'pro',
    features: [
      '5 servidores remotos conectados',
      '30 deployments entre containers y stacks',
      '30 subdominios zoneploy.app',
      '5 add-ons instalados',
    ],
    maxServers: 5,
    maxDeployments: 30,
    maxSubdomains: 30,
    maxCustomDomains: -1,
    maxInstalledAddOns: 5,
    priceMonthlyUsd: '20.00',
    sortOrder: 2,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    features: [
      'Servidores remotos ilimitados',
      'Deployments ilimitados',
      '50 subdominios zoneploy.app',
      'Add-ons instalados ilimitados',
    ],
    maxServers: -1,
    maxDeployments: -1,
    maxSubdomains: 50,
    maxCustomDomains: -1,
    maxInstalledAddOns: -1,
    priceMonthlyUsd: '299.00',
    sortOrder: 3,
  },
]
