import { createHash, X509Certificate } from 'node:crypto'
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import * as acme from 'acme-client'
import { db } from '../db/client.js'
import { customPublicEndpoints } from '../db/schema.js'
import { config } from '../config.js'
import { resolveCustomDomainRoutingForOwner } from './custom-domain-routing.js'

const storageRoot = config.CUSTOM_DOMAIN_STORAGE_ROOT
const accountsRoot = join(storageRoot, 'accounts')
const certsRoot = join(storageRoot, 'certs')
const nginxRoot = join(storageRoot, 'nginx')
const challengesRoot = join(storageRoot, 'challenges')
const challengeTokensRoot = join(challengesRoot, '.well-known', 'acme-challenge')
const reloadTriggerPath = join(storageRoot, 'reload.trigger')

function hasTlsProvisioningConfig() {
  return Boolean(config.CUSTOM_DOMAIN_ACME_EMAIL && config.CUSTOM_DOMAIN_ACME_DIRECTORY_URL)
}

function getAccountKeyPath() {
  const hash = createHash('sha1')
    .update(config.CUSTOM_DOMAIN_ACME_DIRECTORY_URL ?? 'missing-directory-url')
    .digest('hex')
    .slice(0, 10)

  return join(accountsRoot, `acme-account-${hash}.pem`)
}

function getCertDir(domain: string) {
  return join(certsRoot, domain)
}

function getNginxConfPath(domain: string) {
  return join(nginxRoot, `${domain}.conf`)
}

async function ensureStorageDirs() {
  await Promise.all([
    mkdir(accountsRoot, { recursive: true }),
    mkdir(certsRoot, { recursive: true }),
    mkdir(nginxRoot, { recursive: true }),
    mkdir(challengeTokensRoot, { recursive: true }),
  ])
}

async function readOptional(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function writeIfChanged(path: string, content: string, mode?: number) {
  const current = await readOptional(path)
  if (current === content) return false

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, mode !== undefined ? { mode } : undefined)
  return true
}

async function touchReloadTrigger() {
  const now = new Date()

  try {
    await utimes(reloadTriggerPath, now, now)
  } catch {
    await writeFile(reloadTriggerPath, `${now.toISOString()}\n`)
  }
}

async function getOrCreateAccountKey() {
  const path = getAccountKeyPath()
  const existing = await readOptional(path)
  if (existing) return existing

  const accountKey = await acme.crypto.createPrivateKey()
  const normalized = String(accountKey)
  await writeFile(path, normalized, { mode: 0o600 })
  return normalized
}

async function certificateIsFresh(domain: string) {
  const certPath = join(getCertDir(domain), 'fullchain.pem')

  try {
    const pem = await readFile(certPath, 'utf8')
    const certificate = new X509Certificate(pem)
    const validTo = new Date(certificate.validTo)
    const renewBefore = config.CUSTOM_DOMAIN_RENEW_BEFORE_DAYS * 24 * 60 * 60 * 1000
    return validTo.getTime() - Date.now() > renewBefore
  } catch {
    return false
  }
}

async function requestCertificate(domain: string) {
  const accountKey = await getOrCreateAccountKey()
  const client = new acme.Client({
    directoryUrl: config.CUSTOM_DOMAIN_ACME_DIRECTORY_URL!,
    accountKey,
  })

  const [privateKey, csr] = await acme.crypto.createCsr({
    commonName: domain,
  })

  const certificate = await client.auto({
    csr,
    email: config.CUSTOM_DOMAIN_ACME_EMAIL!,
    termsOfServiceAgreed: true,
    challengePriority: ['http-01'],
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      const token = challenge.token
      if (!token) throw new Error(`Missing ACME challenge token for ${domain}`)
      await writeFile(join(challengeTokensRoot, token), keyAuthorization, { mode: 0o644 })
    },
    challengeRemoveFn: async (_authz, challenge) => {
      const token = challenge.token
      if (!token) return
      await rm(join(challengeTokensRoot, token), { force: true })
    },
  })

  return {
    fullchainPem: String(certificate),
    privateKeyPem: String(privateKey),
  }
}

function buildNginxConfig(domain: string) {
  const certDir = getCertDir(domain).replace(/\\/g, '/')
  return `server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain};

    ssl_certificate ${certDir}/fullchain.pem;
    ssl_certificate_key ${certDir}/key.pem;
    include /etc/nginx/snippets/zoneploy-ssl-params.conf;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:${config.GATEWAY_PORT};
        include /etc/nginx/snippets/zoneploy-proxy.conf;
        proxy_read_timeout 120s;
    }
}
`
}

export async function ensureCustomDomainTls(domain: string, logger?: FastifyBaseLogger) {
  if (!hasTlsProvisioningConfig()) {
    logger?.warn({ domain }, '[custom-domain-tls] ACME provisioning is not configured')
    return { enabled: false, changed: false }
  }

  await ensureStorageDirs()

  let changed = false

  if (!(await certificateIsFresh(domain))) {
    logger?.info({ domain }, '[custom-domain-tls] Issuing or renewing certificate')
    const { fullchainPem, privateKeyPem } = await requestCertificate(domain)
    const certDir = getCertDir(domain)
    await mkdir(certDir, { recursive: true })
    changed = await writeIfChanged(join(certDir, 'fullchain.pem'), fullchainPem, 0o644) || changed
    changed = await writeIfChanged(join(certDir, 'key.pem'), privateKeyPem, 0o600) || changed
  }

  changed = await writeIfChanged(getNginxConfPath(domain), buildNginxConfig(domain), 0o644) || changed

  if (changed) {
    await touchReloadTrigger()
  }

  return { enabled: true, changed }
}

export async function removeCustomDomainTls(domain: string) {
  const confPath = getNginxConfPath(domain)
  const certDir = getCertDir(domain)

  let changed = false

  try {
    await stat(confPath)
    await rm(confPath, { force: true })
    changed = true
  } catch {
    // noop
  }

  try {
    await stat(certDir)
    await rm(certDir, { recursive: true, force: true })
    changed = true
  } catch {
    // noop
  }

  if (changed) {
    await touchReloadTrigger()
  }

  return { changed }
}

async function listVerifiedCustomDomains() {
  const verifiedEndpoints = await db
    .select({
      domain: customPublicEndpoints.hostname,
      ownerType: customPublicEndpoints.ownerType,
      ownerId: customPublicEndpoints.ownerId,
    })
    .from(customPublicEndpoints)
    .where(and(eq(customPublicEndpoints.verified, true), isNull(customPublicEndpoints.deletedAt)))

  const domains = new Set<string>()

  for (const endpoint of verifiedEndpoints) {
    const routing = await resolveCustomDomainRoutingForOwner(endpoint.ownerType, endpoint.ownerId)
    if (routing.mode === 'server') {
      domains.add(endpoint.domain)
    }
  }

  return Array.from(domains).sort()
}

export async function reconcileCustomDomainTls(logger?: FastifyBaseLogger) {
  if (!hasTlsProvisioningConfig()) {
    logger?.info('[custom-domain-tls] Skipping reconcile because ACME provisioning is disabled')
    return
  }

  const domains = await listVerifiedCustomDomains()
  for (const domain of domains) {
    try {
      await ensureCustomDomainTls(domain, logger)
    } catch (error) {
      logger?.error({ err: error, domain }, '[custom-domain-tls] Failed to reconcile certificate')
    }
  }
}

export function startCustomDomainTlsReconciler(logger: FastifyBaseLogger) {
  if (!hasTlsProvisioningConfig()) {
    logger.info('[custom-domain-tls] ACME provisioning disabled for this environment')
    return
  }

  reconcileCustomDomainTls(logger).catch(err => logger.error({ err }, '[custom-domain-tls] Initial reconcile failed'))

  const TWELVE_HOURS = 12 * 60 * 60 * 1000
  setInterval(
    () => reconcileCustomDomainTls(logger).catch(err => logger.error({ err }, '[custom-domain-tls] Periodic reconcile failed')),
    TWELVE_HOURS,
  )
}
