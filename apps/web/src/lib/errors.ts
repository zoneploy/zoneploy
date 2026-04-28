import type { TFunction } from 'i18next'
import { ApiError } from './api-client'

// Maps API error codes to i18n keys.
const ERROR_CODE_MAP: Record<string, string> = {
  CONFLICT: 'errors.conflict',
  NOT_FOUND: 'errors.notFound',
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  VALIDATION_ERROR: 'errors.validation',
  INVALID_CREDENTIALS: 'errors.invalidCredentials',
  TOKEN_EXPIRED: 'errors.tokenExpired',
  ORG_2FA_REQUIRED: 'errors.orgTwoFactorRequired',
  SEED_REQUIRED: 'errors.server',
  INTERNAL_ERROR: 'errors.server',
  INVALID_CUSTOM_DOMAIN: 'errors.invalidCustomDomain',
  CUSTOM_DOMAIN_ALREADY_EXISTS: 'errors.customDomainAlreadyExists',
  CUSTOM_DOMAINS_DISABLED: 'errors.customDomainsDisabled',
  CUSTOM_DOMAIN_ROUTING_DISABLED: 'errors.customDomainRoutingDisabled',
  CUSTOM_DOMAIN_ALREADY_VERIFIED: 'errors.customDomainAlreadyVerified',
  ADDON_AGENT_ERROR: 'errors.addonAgentError',
  ADDON_REQUIREMENTS_NOT_MET: 'errors.addonRequirementsNotMet',
  FIREWALL_BACKEND_ACTIVE: 'errors.firewallBackendActive',
  FIREWALL_BACKEND_ACTIVATION_FAILED: 'errors.firewallBackendActivationFailed',
  FIREWALL_BACKEND_CONFLICT: 'errors.firewallBackendConflict',
  FIREWALL_BACKEND_NOT_INSTALLED: 'errors.firewallBackendNotInstalled',
  FIREWALL_BACKEND_UNSUPPORTED: 'errors.firewallBackendUnsupported',
  SERVER_ALREADY_CONNECTED: 'errors.serverAlreadyConnected',
  SERVER_ALREADY_DISCONNECTING: 'errors.serverAlreadyDisconnecting',
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
