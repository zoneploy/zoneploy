import type { AddOnControlPlane, AddOnManagedComponent, AddOnUiMetadata } from '../../../db/schema.js'

export type AddOnBindingScope = 'container' | 'stack'

export interface AddOnCatalogDefinition {
  name: string
  slug: string
  description: string
  category: 'networking' | 'security' | 'email' | 'observability' | 'infrastructure'
  controlPlane: AddOnControlPlane
  installationScope: 'server'
  bindingScopes: AddOnBindingScope[]
  capabilities: Record<string, unknown>
  requirements: {
    requiredCapabilities: string[]
    freeTcpPorts: number[]
  }
  managedComponents: AddOnManagedComponent[]
  uiMetadata: AddOnUiMetadata
  isActive: boolean
}

export interface PlanAddOnCatalogEntry {
  addonSlug: string
  limits?: Record<string, unknown>
}
