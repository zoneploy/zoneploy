import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs in its own process, so read DATABASE_URL directly from process.env
// without going through the strict config.ts validator.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not defined. Run with an env file or load the environment first.')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
})
