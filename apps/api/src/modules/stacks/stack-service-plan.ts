import { parse as parseYaml } from 'yaml'

export type StackRuntimeServiceStatus = 'running' | 'stopped' | 'restarting' | 'unknown'
export type StackLifecycleStatus = 'created' | 'deploying' | 'running' | 'partial' | 'stopped' | 'error'

const MAX_EXPANDED_PORT_RANGE = 256

export function mapRuntimeStatus(status: string): StackRuntimeServiceStatus {
  const normalized = status.toLowerCase()
  if (normalized.includes('running') || normalized === 'created') return 'running'
  if (normalized.includes('restart')) return 'restarting'
  if (normalized.includes('exit') || normalized.includes('dead') || normalized.includes('stop')) return 'stopped'
  return 'unknown'
}

export function deriveStackStatusFromServices(
  services: Array<{ status: StackRuntimeServiceStatus }>,
  fallback: StackLifecycleStatus,
): StackLifecycleStatus {
  if (services.length === 0) return fallback

  const runningCount = services.filter(service => service.status === 'running').length
  const stoppedCount = services.filter(service => service.status === 'stopped').length

  if (runningCount === services.length) return 'running'
  if (stoppedCount === services.length) return 'stopped'
  return 'partial'
}

export function listDeclaredComposeServices(composeContent: string | null): string[] {
  return Object.keys(parseComposeServices(composeContent))
}

export function listComposeServicePorts(composeContent: string | null): Array<{ serviceName: string; ports: number[] }> {
  const services = parseComposeServices(composeContent)

  return Object.entries(services).map(([serviceName, service]) => ({
    serviceName,
    ports: listServicePorts(service),
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseComposeServices(composeContent: string | null): Record<string, Record<string, unknown>> {
  if (!composeContent?.trim()) return {}

  try {
    const parsed = parseYaml(composeContent, { merge: true }) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.services)) return {}

    const services: Record<string, Record<string, unknown>> = {}
    for (const [serviceName, service] of Object.entries(parsed.services)) {
      if (!serviceName.trim()) continue
      services[serviceName] = isRecord(service) ? service : {}
    }
    return services
  } catch {
    return {}
  }
}

function listServicePorts(service: Record<string, unknown>): number[] {
  const ports: number[] = []
  const addPorts = (values: number[]) => {
    for (const value of values) {
      if (!ports.includes(value)) ports.push(value)
    }
  }

  for (const portEntry of normalizeList(service.ports)) {
    addPorts(parsePortEntry(portEntry))
  }

  for (const exposeEntry of normalizeList(service.expose)) {
    addPorts(parsePortToken(exposeEntry))
  }

  return ports
}

function normalizeList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  return [value]
}

function parsePortEntry(value: unknown): number[] {
  if (isRecord(value)) {
    return parsePortToken(value.target)
  }

  return parsePortToken(value)
}

function parsePortToken(value: unknown): number[] {
  if (typeof value === 'number') return normalizePortValue(value)
  if (typeof value !== 'string') return []

  const targetToken = value
    .trim()
    .replace(/\/(?:tcp|udp|sctp)$/i, '')
    .split(':')
    .at(-1)

  if (!targetToken) return []
  return parsePortRange(targetToken)
}

function parsePortRange(value: string): number[] {
  const match = value.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!match?.[1]) return []

  const start = Number.parseInt(match[1], 10)
  const end = match[2] ? Number.parseInt(match[2], 10) : start
  if (!isValidPort(start) || !isValidPort(end) || end < start) return []

  const count = end - start + 1
  if (count > MAX_EXPANDED_PORT_RANGE) return [start]

  return Array.from({ length: count }, (_, index) => start + index)
}

function normalizePortValue(value: number): number[] {
  return Number.isInteger(value) && isValidPort(value) ? [value] : []
}

function isValidPort(value: number): boolean {
  return value > 0 && value <= 65535
}

export function resolveComposeServiceByPort(composeContent: string | null, port: number): string | null {
  const services = listComposeServicePorts(composeContent)
  const match = services.find(service => service.ports.includes(port))
  return match?.serviceName ?? null
}

function parsePortNumber(value: string): number | null {
  const match = value.match(/^(\d+)\//)
  if (!match?.[1]) return null
  const port = parseInt(match[1], 10)
  return Number.isNaN(port) ? null : port
}

export function listRuntimeServicePortsFromInspect(inspect: unknown): number[] {
  if (!inspect || typeof inspect !== 'object') return []

  const ports = new Set<number>()
  const config = 'Config' in inspect && inspect.Config && typeof inspect.Config === 'object'
    ? inspect.Config as { ExposedPorts?: Record<string, unknown> }
    : null
  const networkSettings = 'NetworkSettings' in inspect && inspect.NetworkSettings && typeof inspect.NetworkSettings === 'object'
    ? inspect.NetworkSettings as { Ports?: Record<string, unknown> }
    : null

  for (const key of Object.keys(config?.ExposedPorts ?? {})) {
    const port = parsePortNumber(key)
    if (port) ports.add(port)
  }

  for (const key of Object.keys(networkSettings?.Ports ?? {})) {
    const port = parsePortNumber(key)
    if (port) ports.add(port)
  }

  return Array.from(ports).sort((a, b) => a - b)
}
