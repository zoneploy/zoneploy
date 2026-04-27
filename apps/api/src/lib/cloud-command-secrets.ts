import { decrypt, encrypt, type EncryptedPayload } from './crypto.js'

type EncryptedCommandSecret = EncryptedPayload & {
  __zoneployEncryptedSecret: true
}

function cloneAction(action: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(action ?? {})) as Record<string, unknown>
}

function getGitPayload(action: Record<string, unknown>): Record<string, unknown> | null {
  const input = action.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const git = (input as Record<string, unknown>).git
  if (!git || typeof git !== 'object' || Array.isArray(git)) return null

  return git as Record<string, unknown>
}

function isEncryptedSecret(value: unknown): value is EncryptedCommandSecret {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { __zoneployEncryptedSecret?: unknown }).__zoneployEncryptedSecret === true,
  )
}

export function encryptCommandActionSecrets(action: unknown): Record<string, unknown> {
  const clone = cloneAction(action)
  const git = getGitPayload(clone)
  const token = git?.token

  if (git && typeof token === 'string' && token.trim()) {
    git.token = {
      __zoneployEncryptedSecret: true,
      ...encrypt(token),
    } satisfies EncryptedCommandSecret
  }

  return clone
}

export function decryptCommandActionSecrets(action: unknown): Record<string, unknown> {
  const clone = cloneAction(action)
  const git = getGitPayload(clone)
  const token = git?.token

  if (git && isEncryptedSecret(token)) {
    git.token = decrypt(token)
  }

  return clone
}
