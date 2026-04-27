import { randomBytes, createHash } from 'node:crypto'

/** Genera un deploy token en claro: rst_<base64url(32 bytes)> */
export function generateDeployToken(): string {
  const raw = randomBytes(32).toString('base64url')
  return `rst_${raw}`
}

/** Hashes the token for DB storage (SHA-256 hex). */
export function hashDeployToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
