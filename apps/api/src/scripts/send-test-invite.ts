/**
 * Test script: sends a sample invitation email.
 * Usage: pnpm --filter @zoneploy/cloud-api exec dotenv -e ../../.env.development -- tsx src/scripts/send-test-invite.ts
 */
import { sendMail, invitationEmail } from '../lib/mailer.js'

const mail = invitationEmail({
  organizationName: 'Acme Corp',
  invitedByName: 'Maria Garcia',
  role: 'member',
  inviteUrl: 'http://localhost:5173/invite/test-token-preview',
  lang: 'es',
})

console.log('Sending test invitation email...')

await sendMail({
  to: 'karlosagreda@hotmail.com',
  ...mail,
})

console.log('Email sent')
