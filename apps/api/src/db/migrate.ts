import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { config } from '../config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function runMigrations() {
  const client = postgres(config.DATABASE_URL, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: join(__dirname, 'migrations') })
  } finally {
    await client.end()
  }
}

// Direct execution: tsx src/db/migrate.ts  |  node dist/db/migrate.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('▶ Ejecutando migraciones...')
  await runMigrations()
  console.log('✔ Migraciones completadas')
}
