import { z } from 'zod'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const optionalString = z.preprocess(emptyToUndefined, z.string().optional())
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional())
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional())

const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // AES-256-GCM encryption (exactly 32 chars = 256 bits)
  ENCRYPTION_KEY: z.string().length(32),

  // Public frontend URL for browser-facing links and WebAuthn origin checks.
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Extra CORS origins separated by commas, for example local development.
  EXTRA_CORS_ORIGINS: z.string().optional(),

  // Public Platform URL used by server agents.
  // Defaults to the same host on the backend port.
  PLATFORM_URL: z.string().url().default('http://localhost:3000'),
  SELF_HOSTED_INSTALL_URL: z.string().url().default('https://raw.githubusercontent.com/zoneploy/zoneploy/development/install.sh'),
  ZONEPLOY_AGENT_API_TOKEN: optionalString,
  LOCAL_AGENT_HOST: z.string().default('host.docker.internal'),
  LOCAL_AGENT_PORT: z.coerce.number().default(4000),

  // Domain suffix used for Zoneploy-managed public routes.
  ROUTING_DOMAIN: z.string().default('zoneploy.app'),
  SUBDOMAIN_SUFFIX: z.string().default(''), // Example: ".dev" in development, empty in production.
  GATEWAY_PORT: z.coerce.number().default(8181),
  CUSTOM_DOMAIN_STORAGE_ROOT: z.string().default('/opt/zoneploy/custom-domains'),
  CUSTOM_DOMAIN_ACME_EMAIL: optionalEmail,
  CUSTOM_DOMAIN_ACME_DIRECTORY_URL: optionalUrl,
  CUSTOM_DOMAIN_RENEW_BEFORE_DAYS: z.coerce.number().int().positive().default(30),

  // Wildcard cert for HTTPS (*.ROUTING_DOMAIN).
  // Directory containing cert.pem and key.pem from setup-wildcard-cert.sh.
  // When configured and present, servers are provisioned in HTTPS mode.
  // The SNI gateway (apps/gateway/) requires DNS *.ROUTING_DOMAIN to point to the control plane IP.
  CERTS_PATH: z.string().optional(),

  // Secret token for the internal POST /api/v1/internal/servers/push-certs endpoint.
  // Used by renew-and-push.sh to distribute renewed certs to all active servers.
  INTERNAL_API_TOKEN: z.string().optional(),

})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
