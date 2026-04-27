import type { TFunction } from 'i18next'
import { ApiError } from './api-client'

// Maps API error codes to i18n keys.
const ERROR_CODE_MAP: Record<string, string> = {
  CONFLICT: 'errors.conflict',
  NOT_FOUND: 'errors.notFound',
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  VALIDATION_ERROR: 'errors.validation',
  PLAN_LIMIT_EXCEEDED: 'errors.planLimit',
  PLAN_FEATURE_REQUIRES_PAID_PLAN: 'errors.planFeatureRequiresPaidPlan',
  ACTIVE_SUBSCRIPTION_NOT_FOUND: 'errors.activeSubscriptionNotFound',
  PLAN_NOT_FOUND: 'errors.planNotFound',
  PLAN_MAX_SERVERS_REACHED: 'errors.planMaxServersReached',
  PLAN_MAX_DEPLOYMENTS_REACHED: 'errors.planMaxDeploymentsReached',
  PLAN_MAX_SUBDOMAINS_REACHED: 'errors.planMaxSubdomainsReached',
  PLAN_MAX_CUSTOM_DOMAINS_REACHED: 'errors.planMaxCustomDomainsReached',
  PLAN_MAX_INSTALLED_ADDONS_REACHED: 'errors.planMaxInstalledAddOnsReached',
  PLAN_DOWNGRADE_MAX_SERVERS_EXCEEDED: 'errors.planDowngradeMaxServersExceeded',
  PLAN_DOWNGRADE_MAX_DEPLOYMENTS_EXCEEDED: 'errors.planDowngradeMaxDeploymentsExceeded',
  PLAN_DOWNGRADE_MAX_SUBDOMAINS_EXCEEDED: 'errors.planDowngradeMaxSubdomainsExceeded',
  PLAN_DOWNGRADE_MAX_CUSTOM_DOMAINS_EXCEEDED: 'errors.planDowngradeMaxCustomDomainsExceeded',
  PLAN_DOWNGRADE_MAX_INSTALLED_ADDONS_EXCEEDED: 'errors.planDowngradeMaxInstalledAddOnsExceeded',
  SUBSCRIPTION_CHANGES_PRELAUNCH_DISABLED: 'errors.subscriptionChangesPrelaunchDisabled',
  EMAIL_NOT_VERIFIED: 'errors.emailNotVerified',
  INVALID_CREDENTIALS: 'errors.invalidCredentials',
  TOKEN_EXPIRED: 'errors.tokenExpired',
  ORG_2FA_REQUIRED: 'errors.orgTwoFactorRequired',
  SEED_REQUIRED: 'errors.server',
  INTERNAL_ERROR: 'errors.server',
  INVALID_CUSTOM_DOMAIN: 'errors.invalidCustomDomain',
  INVALID_ZONEPLOY_SLUG: 'errors.invalidZoneploySlug',
  ZONEPLOY_HOSTNAME_RESERVED: 'errors.zoneployHostnameReserved',
  ZONEPLOY_PORT_ALREADY_EXISTS: 'errors.zoneployPortAlreadyExists',
  ZONEPLOY_HOSTNAME_IN_USE: 'errors.zoneployHostnameInUse',
  CUSTOM_DOMAIN_ALREADY_EXISTS: 'errors.customDomainAlreadyExists',
  CUSTOM_DOMAINS_DISABLED: 'errors.customDomainsDisabled',
  CUSTOM_DOMAINS_ADDON_REQUIRED: 'errors.customDomainsAddonRequired',
  CUSTOM_DOMAIN_ALREADY_VERIFIED: 'errors.customDomainAlreadyVerified',
  ADDON_AGENT_ERROR: 'errors.addonAgentError',
  ADDON_REQUIREMENTS_NOT_MET: 'errors.addonRequirementsNotMet',
  EDGE_PORTS_IN_USE: 'errors.edgePortsInUse',
  FIREWALL_BACKEND_ACTIVE: 'errors.firewallBackendActive',
  FIREWALL_BACKEND_ACTIVATION_FAILED: 'errors.firewallBackendActivationFailed',
  FIREWALL_BACKEND_CONFLICT: 'errors.firewallBackendConflict',
  FIREWALL_BACKEND_NOT_INSTALLED: 'errors.firewallBackendNotInstalled',
  FIREWALL_BACKEND_UNSUPPORTED: 'errors.firewallBackendUnsupported',
  SERVER_ALREADY_CONNECTED: 'errors.serverAlreadyConnected',
  SERVER_ALREADY_DISCONNECTING: 'errors.serverAlreadyDisconnecting',
  OAUTH_PROVIDER_DISABLED: 'errors.oauthProviderDisabled',
  OAUTH_EMAIL_NOT_VERIFIED: 'errors.oauthEmailNotVerified',
  OAUTH_EMAIL_REQUIRED: 'errors.oauthEmailRequired',
  OAUTH_EXCHANGE_FAILED: 'errors.oauthExchangeFailed',
  OAUTH_PROFILE_FAILED: 'errors.oauthProfileFailed',
}

/**
 * Converts an API error into a translated message.
 * Raw server messages should never be shown to end users.
 */
export function getApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const mapped = ERROR_CODE_MAP[err.code]
    if (mapped) return t(mapped)
    if (err.status >= 500) return t('errors.server')
    if (err.status === 409) return t('errors.conflict')
    if (err.status === 403) return t('errors.forbidden')
    if (err.status === 404) return t('errors.notFound')
    if (err.status === 400) return t('errors.validation')
  }

  return t('common.error')
}
