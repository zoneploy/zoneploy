import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(config.ENCRYPTION_KEY, 'utf-8')

export interface EncryptedPayload {
  encrypted: string
  iv: string
  authTag: string
}

export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(12) // 96 bits recommended for GCM.
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

export function decrypt(payload: EncryptedPayload): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(payload.iv, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, 'hex')),
    decipher.final(),
  ])

  return decrypted.toString('utf-8')
}
