import { config } from '../config.js'

interface MailOptions {
  to: string
  subject: string
  html: string
}

/**
 * Sends an email. In development without SMTP configured, prints to console.
 * In production, uses nodemailer with .env credentials.
 */
export async function sendMail(opts: MailOptions): Promise<void> {
  if (!config.SMTP_HOST) {
    console.log('\n📧 ─── EMAIL (modo dev — sin SMTP) ───────────────────')
    console.log(`  Para:    ${opts.to}`)
    console.log(`  Asunto:  ${opts.subject}`)
    console.log(`  Cuerpo:  ${opts.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
    console.log('────────────────────────────────────────────────────\n')
    return
  }

  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  })
}

// Palette
// bg outer : #f1f5f9   card: #ffffff   border: #e2e8f0
// primary  : #00bae1   text: #0f172a   muted : #64748b

// Base template

function emailBase(content: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Zoneploy</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">
                Zone<span style="color:#00bae1;">ploy</span>
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                ${footer}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Centered CTA button
// Uses a table with margin:0 auto for correct centering across email clients.

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>
      <td align="center" bgcolor="#00bae1" style="border-radius:10px;background-color:#00bae1;">
        <a href="${href}"
          target="_blank"
          style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:-0.2px;mso-padding-alt:0;text-align:center;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

// Templates

// Copy by language

const i18n = {
  es: {
    verifySubject: 'Confirmá tu email — Zoneploy',
    verifyTitle: 'Confirmá tu email',
    verifyBody: (name: string) => `Hola <strong style="color:#0f172a;">${name}</strong>, hacé clic en el botón para verificar tu cuenta.`,
    verifyCta: 'Verificar email',
    verifyFallback: 'O copiá este enlace en tu navegador:',
    verifyExpiry: 'Este enlace expira en 24 horas.',
    inviteSubject: (org: string) => `Te invitaron a ${org} en Zoneploy`,
    inviteTitle: (org: string) => `Fuiste invitado a<br/><span style="color:#00bae1;">${org}</span>`,
    inviteBody: (by: string, role: string) => `<strong style="color:#0f172a;">${by}</strong> te invitó a colaborar con el rol de <strong style="color:#0f172a;">${role}</strong>.`,
    inviteCta: 'Aceptar invitación',
    inviteFallback: 'O copiá este enlace en tu navegador:',
    inviteExpiry: 'Este enlace expira en 48 horas.',
    footer: (year: number) => `© ${year} Zoneploy · Si no creaste esta cuenta, ignorá este email.`,
  },
  en: {
    verifySubject: 'Confirm your email — Zoneploy',
    verifyTitle: 'Confirm your email',
    verifyBody: (name: string) => `Hi <strong style="color:#0f172a;">${name}</strong>, click the button below to verify your account.`,
    verifyCta: 'Verify email',
    verifyFallback: 'Or copy this link into your browser:',
    verifyExpiry: 'This link expires in 24 hours.',
    inviteSubject: (org: string) => `You've been invited to ${org} on Zoneploy`,
    inviteTitle: (org: string) => `You've been invited to<br/><span style="color:#00bae1;">${org}</span>`,
    inviteBody: (by: string, role: string) => `<strong style="color:#0f172a;">${by}</strong> invited you to collaborate with the role of <strong style="color:#0f172a;">${role}</strong>.`,
    inviteCta: 'Accept invitation',
    inviteFallback: 'Or copy this link into your browser:',
    inviteExpiry: 'This link expires in 48 hours.',
    footer: (year: number) => `© ${year} Zoneploy · If you didn't create this account, you can safely ignore this email.`,
  },
}

type Lang = 'es' | 'en'

export function verificationEmail(opts: {
  fullName: string
  verifyUrl: string
  lang?: Lang
}) {
  const t = i18n[opts.lang ?? 'es']
  return {
    subject: t.verifySubject,
    html: emailBase(`
      <div style="padding:40px 40px 36px;">

        <!-- Icon -->
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background-color:#e0f9ff;border-radius:50%;width:64px;height:64px;text-align:center;line-height:64px;font-size:28px;">
            ✉️
          </div>
        </div>

        <!-- Title -->
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;letter-spacing:-0.4px;">
          ${t.verifyTitle}
        </h1>
        <p style="margin:0 0 32px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          ${t.verifyBody(opts.fullName)}
        </p>

        <!-- CTA -->
        <div style="margin-bottom:32px;">
          ${ctaButton(opts.verifyUrl, t.verifyCta)}
        </div>

        <!-- Divider -->
        <div style="border-top:1px solid #e2e8f0;margin-bottom:24px;"></div>

        <!-- Fallback link -->
        <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.7;text-align:center;">
          ${t.verifyFallback}<br/>
          <a href="${opts.verifyUrl}" style="color:#00bae1;word-break:break-all;font-size:12px;">${opts.verifyUrl}</a>
        </p>

        <!-- Expiry -->
        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
          ${t.verifyExpiry}
        </p>

      </div>
    `, t.footer(new Date().getFullYear())),
  }
}

export function invitationEmail(opts: {
  organizationName: string
  invitedByName: string
  role: string
  inviteUrl: string
  lang?: Lang
}) {
  const t = i18n[opts.lang ?? 'es']
  return {
    subject: t.inviteSubject(opts.organizationName),
    html: emailBase(`
      <div style="padding:40px 40px 36px;">

        <!-- Icon -->
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background-color:#e0f9ff;border-radius:50%;width:64px;height:64px;text-align:center;line-height:64px;font-size:28px;">
            🚀
          </div>
        </div>

        <!-- Title -->
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;letter-spacing:-0.4px;">
          ${t.inviteTitle(opts.organizationName)}
        </h1>
        <p style="margin:0 0 32px;font-size:15px;color:#64748b;text-align:center;line-height:1.6;">
          ${t.inviteBody(opts.invitedByName, opts.role)}
        </p>

        <!-- CTA -->
        <div style="margin-bottom:32px;">
          ${ctaButton(opts.inviteUrl, t.inviteCta)}
        </div>

        <!-- Divider -->
        <div style="border-top:1px solid #e2e8f0;margin-bottom:24px;"></div>

        <!-- Fallback link -->
        <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.7;text-align:center;">
          ${t.inviteFallback}<br/>
          <a href="${opts.inviteUrl}" style="color:#00bae1;word-break:break-all;font-size:12px;">${opts.inviteUrl}</a>
        </p>

        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
          ${t.inviteExpiry}
        </p>

      </div>
    `, t.footer(new Date().getFullYear())),
  }
}
