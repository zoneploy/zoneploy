import type { ProvisionLogEntry } from '@zoneploy/types'

type ProvisionLogServerState = {
  status?: string | null
  deletedAt?: Date | string | null
} | null | undefined

export function buildProvisionLogFlush(input: {
  entries: ProvisionLogEntry[]
  cursor: number
  server: ProvisionLogServerState
}) {
  const safeCursor = Math.max(0, Math.min(input.cursor, input.entries.length))
  const newEntries = input.entries.slice(safeCursor)
  const serverStatus = input.server?.status
  const inProgress =
    !input.server?.deletedAt &&
    (serverStatus === 'provisioning' || serverStatus === 'disconnecting')

  return {
    newEntries,
    nextCursor: input.entries.length,
    shouldEnd: !inProgress,
  }
}
