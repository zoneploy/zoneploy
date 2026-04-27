import { eq, and } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { containerSecrets, containers } from '../../db/schema.js'
import { encrypt } from '../../lib/crypto.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'

async function markNeedsRedeploy(containerId: string) {
  await db
    .update(containers)
    .set({ needsRedeploy: true, updatedAt: new Date() })
    .where(eq(containers.id, containerId))
}

// Helpers

async function assertContainerOwnership(orgId: string, containerId: string) {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.orgId, orgId)))
    .limit(1)

  if (!container) throw new NotFoundError('Container no encontrado')
}

function validateKey(key: string) {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new ValidationError('La clave solo puede contener letras mayúsculas, números y guiones bajos (ej: DATABASE_URL)')
  }
}

// Services

export async function listSecrets(orgId: string, containerId: string) {
  await assertContainerOwnership(orgId, containerId)

  // Return only keys, never values.
  return db
    .select({
      id: containerSecrets.id,
      key: containerSecrets.key,
      createdAt: containerSecrets.createdAt,
      updatedAt: containerSecrets.updatedAt,
    })
    .from(containerSecrets)
    .where(eq(containerSecrets.containerId, containerId))
    .orderBy(containerSecrets.key)
}

export async function upsertSecret(
  orgId: string,
  containerId: string,
  key: string,
  value: string,
) {
  await assertContainerOwnership(orgId, containerId)
  validateKey(key)

  const encrypted = encrypt(value)

  // Upsert: actualiza si existe, crea si no
  const existing = await db
    .select({ id: containerSecrets.id })
    .from(containerSecrets)
    .where(and(eq(containerSecrets.containerId, containerId), eq(containerSecrets.key, key)))
    .limit(1)

  let result
  if (existing.length > 0) {
    const [updated] = await db
      .update(containerSecrets)
      .set({
        valueEncrypted: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        updatedAt: new Date(),
      })
      .where(and(eq(containerSecrets.containerId, containerId), eq(containerSecrets.key, key)))
      .returning({ id: containerSecrets.id, key: containerSecrets.key, updatedAt: containerSecrets.updatedAt })

    result = updated
  } else {
    const [created] = await db
      .insert(containerSecrets)
      .values({
        containerId,
        orgId,
        key,
        valueEncrypted: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      })
      .returning({ id: containerSecrets.id, key: containerSecrets.key, createdAt: containerSecrets.createdAt, updatedAt: containerSecrets.updatedAt })

    result = created
  }

  await markNeedsRedeploy(containerId)
  return result
}

export async function deleteSecret(orgId: string, containerId: string, key: string) {
  await assertContainerOwnership(orgId, containerId)

  const [deleted] = await db
    .delete(containerSecrets)
    .where(and(eq(containerSecrets.containerId, containerId), eq(containerSecrets.key, key)))
    .returning({ id: containerSecrets.id })

  if (!deleted) throw new NotFoundError(`Secret "${key}" no encontrado`)

  await markNeedsRedeploy(containerId)
}
