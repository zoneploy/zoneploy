import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { db } from '../../db/client.js'
import { users } from '../../db/schema.js'
import { NotFoundError, UnauthorizedError, ValidationError } from '../../lib/errors.js'

// Update the profile name.
export async function updateProfile(userId: string, fullName: string) {
  const [user] = await db
    .update(users)
    .set({ fullName, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id, fullName: users.fullName, email: users.email })
  if (!user) throw new NotFoundError('User not found')
  return user
}

// Change password.
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) throw new NotFoundError('User not found')
  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) throw new UnauthorizedError('Current password is incorrect')
  if (newPassword.length < 8) throw new ValidationError('The new password must be at least 8 characters')
  const hash = await bcrypt.hash(newPassword, 10)
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId))
  return { ok: true }
}

// Configure TOTP by generating the secret and QR code URL.
export async function setupTotp(userId: string, email: string) {
  const secret = generateSecret({ length: 20 })
  const otpauth = generateURI({ issuer: 'Zoneploy', label: email, secret, strategy: 'totp' })
  const qrDataUrl = await QRCode.toDataURL(otpauth)
  // Store the secret; it is not enabled until verification.
  await db.update(users).set({ totpSecret: secret, updatedAt: new Date() }).where(eq(users.id, userId))
  return { secret, qrDataUrl }
}

// Verify TOTP code and enable 2FA.
export async function verifyAndEnableTotp(userId: string, code: string) {
  const [user] = await db
    .select({ totpSecret: users.totpSecret })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user?.totpSecret) throw new ValidationError('Set up the authenticator first')
  const valid = verifySync({ token: code, secret: user.totpSecret, strategy: 'totp' })
  if (!valid) throw new ValidationError('Incorrect code')
  await db.update(users).set({ totpEnabled: true, updatedAt: new Date() }).where(eq(users.id, userId))
  return { ok: true }
}

// Deshabilitar TOTP
export async function disableTotp(userId: string, code: string) {
  const [user] = await db
    .select({ totpSecret: users.totpSecret, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user?.totpEnabled) throw new ValidationError('2FA is not active')
  const valid = verifySync({ token: code, secret: user.totpSecret!, strategy: 'totp' })
  if (!valid) throw new ValidationError('Incorrect code')
  await db.update(users).set({ totpSecret: null, totpEnabled: false, updatedAt: new Date() }).where(eq(users.id, userId))
  return { ok: true }
}

// Get 2FA status.
export async function getTotpStatus(userId: string) {
  const [user] = await db
    .select({ totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { totpEnabled: user?.totpEnabled ?? false }
}
