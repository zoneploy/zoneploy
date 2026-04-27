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
    console.log('\nðŸ“§ â”€â”€â”€ EMAIL (modo dev â€” sin SMTP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€')
    console.log(`  Para:    ${opts.to}`)
    console.log(`  Asunto:  ${opts.subject}`)
    console.log(`  Cuerpo:  ${opts.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
    console.log('â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n')
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
