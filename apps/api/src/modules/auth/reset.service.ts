import { createHash, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users, passwordResetTokens } from '../../db/schema.js'
import { sendMail } from '../../lib/mailer.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  return String(randomInt(100000, 999999))
}

export async function requestPasswordReset(email: string, lang: 'es' | 'en' = 'es') {
  // Silently succeed even if email not found (security)
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!user) return { ok: true }

  // Invalidate old tokens
  await db
    .update(passwordResetTokens)
    .set({ used: true })
    .where(and(eq(passwordResetTokens.email, email), eq(passwordResetTokens.used, false)))

  const code = generateCode()
  const codeHash = hashCode(code)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min

  await db.insert(passwordResetTokens).values({ email, codeHash, expiresAt })

  const subject = lang === 'en' ? 'Your Zoneploy password reset code' : 'Tu código para restablecer contraseña en Zoneploy'
  const body = lang === 'en'
    ? `<p style="margin:0 0 16px">Your password reset code is:</p>
       <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center">${code}</p>
       <p style="margin:0;color:#64748b;font-size:13px">This code expires in 15 minutes. If you did not request this, ignore this email.</p>`
    : `<p style="margin:0 0 16px">Tu código para restablecer la contraseña es:</p>
       <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center">${code}</p>
       <p style="margin:0;color:#64748b;font-size:13px">Este código expira en 15 minutos. Si no lo solicitaste, ignorá este email.</p>`

  await sendMail({
    to: email,
    subject,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:32px;background:#f1f5f9;font-family:sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px">
        <h2 style="margin:0 0 24px;color:#0f172a">${lang === 'en' ? 'Reset your password' : 'Restablecé tu contraseña'}</h2>
        ${body}
      </div>
    </body></html>`,
  })

  return { ok: true }
}

export async function verifyResetCode(email: string, code: string) {
  const codeHash = hashCode(code)

  const [token] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.email, email),
        eq(passwordResetTokens.codeHash, codeHash),
        eq(passwordResetTokens.used, false),
      ),
    )
    .limit(1)

  if (!token) throw new ValidationError('Código incorrecto o expirado')
  if (token.expiresAt < new Date()) {
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, token.id))
    throw new ValidationError('El código expiró. Solicitá uno nuevo.')
  }

  return { ok: true }
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string) {
  if (newPassword.length < 8) throw new ValidationError('La contraseña debe tener al menos 8 caracteres')

  const codeHash = hashCode(code)

  const [token] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.email, email),
        eq(passwordResetTokens.codeHash, codeHash),
        eq(passwordResetTokens.used, false),
      ),
    )
    .limit(1)

  if (!token) throw new ValidationError('Código incorrecto o expirado')
  if (token.expiresAt < new Date()) {
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, token.id))
    throw new ValidationError('El código expiró. Solicitá uno nuevo.')
  }

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) throw new ValidationError('Usuario no encontrado')

  const passwordHash = await bcrypt.hash(newPassword, 10)

  await db.transaction(async tx => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id))
    await tx.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, token.id))
  })

  return { ok: true }
}
