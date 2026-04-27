import type { AddOnCatalogDefinition } from './types.js'

export const ADDON_CATALOG: AddOnCatalogDefinition[] = [
  {
    name: 'Custom Domains Edge',
    slug: 'custom-domains-edge',
    description: 'Terminates custom domains, certificates, and edge routing directly on the local server.',
    category: 'networking',
    controlPlane: 'agent',
    installationScope: 'server',
    bindingScopes: ['container', 'stack'],
    capabilities: { customDomains: true, tls: true, httpRouting: true },
    requirements: {
      requiredCapabilities: ['linux', 'rootAccess', 'systemd', 'packageManagerSupported', 'dockerInstalled', 'dockerRunning'],
      freeTcpPorts: [80, 443],
    },
    managedComponents: [
      { name: 'Traefik', kind: 'proxy' },
      { name: "Let's Encrypt", kind: 'certificate' },
      { name: 'Docker network', kind: 'runtime' },
      { name: 'Ports 80/443', kind: 'firewall' },
    ],
    uiMetadata: {
      iconKey: 'globe',
      logoKey: 'traefik',
      accentColor: '#00B8D9',
      summary: 'Controls Traefik, TLS and public HTTP routing on the selected VPS.',
    },
    isActive: true,
  },
  {
    name: 'Firewall Manager',
    slug: 'firewall-manager',
    description: 'Controls host firewall rules and shared TCP ports from the local server.',
    category: 'security',
    controlPlane: 'agent',
    installationScope: 'server',
    bindingScopes: [],
    capabilities: { firewall: true, tcpPortManagement: true },
    requirements: {
      requiredCapabilities: ['linux', 'rootAccess', 'systemd', 'packageManagerSupported'],
      freeTcpPorts: [],
    },
    managedComponents: [
      { name: 'UFW', kind: 'firewall' },
      { name: 'firewalld', kind: 'firewall' },
      { name: 'iptables', kind: 'firewall' },
    ],
    uiMetadata: {
      iconKey: 'shield',
      logoKey: 'linux-firewall',
      accentColor: '#22C55E',
      summary: 'Controls UFW, firewalld or iptables without owning your workloads.',
    },
    isActive: true,
  },
]

export const ACTIVE_ADDON_SLUGS = new Set(ADDON_CATALOG.filter(addon => addon.isActive).map(addon => addon.slug))

export const AGENT_MANAGED_ADDON_SLUGS = new Set(
  ADDON_CATALOG
    .filter(addon => addon.controlPlane === 'agent')
    .map(addon => addon.slug),
)

export function getAddOnCatalogDefinition(slug: string) {
  return ADDON_CATALOG.find(addon => addon.slug === slug) ?? null
}
