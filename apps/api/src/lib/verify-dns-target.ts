import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

async function resolveCnames(hostname: string) {
  try {
    return await dns.resolveCname(hostname)
  } catch {
    return []
  }
}

async function resolveIpv4(hostname: string) {
  try {
    return await dns.resolve4(hostname)
  } catch {
    return []
  }
}

async function resolveIpv6(hostname: string) {
  try {
    return await dns.resolve6(hostname)
  } catch {
    return []
  }
}

export async function verifyHostnamePointsToTarget(hostname: string, target: string) {
  const normalizedHostname = normalizeHost(hostname)
  const normalizedTarget = normalizeHost(target)
  const targetIpVersion = isIP(normalizedTarget)

  if (targetIpVersion === 4 || targetIpVersion === 6) {
    const [hostV4, hostV6] = await Promise.all([
      resolveIpv4(normalizedHostname),
      resolveIpv6(normalizedHostname),
    ])

    const hostIps = new Set([...hostV4, ...hostV6].map(ip => ip.trim()))
    return hostIps.has(normalizedTarget)
  }

  const cnames = (await resolveCnames(normalizedHostname)).map(normalizeHost)
  if (cnames.includes(normalizedTarget)) {
    return true
  }

  const [hostV4, hostV6, targetV4, targetV6] = await Promise.all([
    resolveIpv4(normalizedHostname),
    resolveIpv6(normalizedHostname),
    resolveIpv4(normalizedTarget),
    resolveIpv6(normalizedTarget),
  ])

  const hostIps = new Set([...hostV4, ...hostV6].map(ip => ip.trim()))
  const targetIps = [...targetV4, ...targetV6].map(ip => ip.trim())

  return targetIps.some(ip => hostIps.has(ip))
}

export function buildDnsTargetInstructions(hostname: string, target: string) {
  const normalizedTarget = normalizeHost(target)
  const targetIpVersion = isIP(normalizedTarget)

  if (targetIpVersion === 4) {
    return [
      'Set an A record:',
      `  ${hostname} -> ${target}`,
    ].join('\n')
  }

  if (targetIpVersion === 6) {
    return [
      'Set an AAAA record:',
      `  ${hostname} -> ${target}`,
    ].join('\n')
  }

  return [
    `Set a CNAME record:`,
    `  ${hostname} -> ${target}`,
    `If your DNS provider does not allow CNAME at the root domain, use ALIAS/ANAME pointing to the same target.`,
  ].join('\n')
}
