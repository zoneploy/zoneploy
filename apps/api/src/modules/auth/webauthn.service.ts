import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users, passkeys } from '../../db/schema.js'
import { redis, REDIS_KEYS } from '../../lib/redis.js'
import { config } from '../../config.js'
import { NotFoundError, ValidationError, UnauthorizedError } from '../../lib/errors.js'

// rpID: APP_URL hostname (localhost in dev, real domain in prod).
function getRpId(): string {
  return new URL(config.APP_URL).hostname
}

function getRpOrigin(): string {
  // En dev el frontend corre en 5173, no en APP_URL
  if (config.NODE_ENV === 'development') {
    return 'http://localhost:5173'
  }
  return config.APP_URL
}

// Registration step 1: generate options

export async function getRegistrationOptions(
  userId: string,
  userEmail: string,
  userName: string,
  attachment?: 'platform' | 'cross-platform',
) {
  const rpId = getRpId()

  // Fetch existing passkeys to exclude them.
  const existing = await db
    .select({ credentialId: passkeys.credentialId })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))

  const options = await generateRegistrationOptions({
    rpName: 'Zoneploy',
    rpID: rpId,
    userName: userEmail,
    userDisplayName: userName,
    attestationType: 'none',
    excludeCredentials: existing.map(p => ({
      id: p.credentialId,
    })),
    authenticatorSelection: {
      // cross-platform = physical key (YubiKey, NFC); skips Windows Hello.
      // platform = device authenticator (Touch ID, Windows Hello, Face ID).
      ...(attachment ? { authenticatorAttachment: attachment } : {}),
      residentKey: 'preferred',
      userVerification: attachment === 'cross-platform' ? 'discouraged' : 'preferred',
    },
  })

  // Store challenge in Redis for 5 minutes.
  await redis.set(
    REDIS_KEYS.webauthnChallenge(userId),
    options.challenge,
    'EX',
    300,
  )

  return options
}

// Registration step 2: verify and save

export async function verifyAndSavePasskey(
  userId: string,
  response: RegistrationResponseJSON,
  deviceName: string,
) {
  const challenge = await redis.get(REDIS_KEYS.webauthnChallenge(userId))
  if (!challenge) throw new ValidationError('Challenge expired, try again')

  const rpId = getRpId()
  const origin = getRpOrigin()

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: false,  // Allows 'discouraged' for physical keys without PIN.
    })
  } catch (err) {
    throw new ValidationError(`Registro fallido: ${(err as Error).message}`)
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new ValidationError('Could not verify the passkey')
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  // Delete the consumed challenge.
  await redis.del(REDIS_KEYS.webauthnChallenge(userId))

  // Guardar passkey en DB
  const [passkey] = await db
    .insert(passkeys)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: deviceName || 'Passkey',
    })
    .returning()

  return { ok: true, passkeyId: passkey!.id }
}

// List user passkeys

export async function listPasskeys(userId: string) {
  return db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt)
}

// Delete passkey

export async function deletePasskey(userId: string, passkeyId: string) {
  const [row] = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .limit(1)

  if (!row) throw new NotFoundError('Passkey not found')

  await db.delete(passkeys).where(eq(passkeys.id, passkeyId))
  return { ok: true }
}

// Authentication step 1: generate options
// Accepts userId for post-login MFA or email for direct login.

export async function getAuthenticationOptions(userIdOrEmail?: string) {
  const rpId = getRpId()

  let allowCredentials: { id: string }[] = []

  if (userIdOrEmail) {
    // Chequear si es UUID (userId) o email
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrEmail)

    let userId: string | undefined

    if (isUuid) {
      userId = userIdOrEmail
    } else {
      // Email input: look up the user.
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, userIdOrEmail))
        .limit(1)

      userId = user?.id
    }

    if (userId) {
      const userPasskeys = await db
        .select({ credentialId: passkeys.credentialId })
        .from(passkeys)
        .where(eq(passkeys.userId, userId))

      allowCredentials = userPasskeys.map(p => ({ id: p.credentialId }))
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    // 'discouraged' prevents Windows from requiring PIN before accessing a physical key.
    userVerification: 'discouraged',
    ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
  })

  // Temporary challenge.
  await redis.set(
    `rs:webauthn:auth:${options.challenge}`,
    options.challenge,
    'EX',
    300,
  )

  return options
}

// Authentication step 2: verify and generate tokens

export async function verifyAuthentication(response: AuthenticationResponseJSON) {
  // Find passkey by credentialId.
  const [passkey] = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, response.id))
    .limit(1)

  if (!passkey) throw new NotFoundError('Passkey no registrada')

  // Retrieve challenge; stored by challenge value.
  const storedChallenge = await redis.get(`rs:webauthn:auth:${response.response.clientDataJSON}`)

  // Alternatively, the client sends the original challenge.
  // Keep this flexible; the key requirement is sending the challenge in the payload.
  // In the simple implementation, use the decoded response.response.clientDataJSON.
  const clientDataDecoded = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
  )
  const challenge = clientDataDecoded.challenge as string

  const challengeKey = `rs:webauthn:auth:${challenge}`
  const savedChallenge = await redis.get(challengeKey)
  if (!savedChallenge) throw new ValidationError('Challenge expired, try again')

  const rpId = getRpId()
  const origin = getRpOrigin()

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: savedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: false,  // Allows physical keys without PIN.
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
      },
    })
  } catch (err) {
    throw new UnauthorizedError(`Authentication failed: ${(err as Error).message}`)
  }

  if (!verification.verified) throw new UnauthorizedError('Authentication was not verified')

  // Clear challenge.
  await redis.del(challengeKey)

  // Update the signature counter.
  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(passkeys.id, passkey.id))

  return { userId: passkey.userId }
}
