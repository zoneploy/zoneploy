/**
 * Idempotent platform seed.
 * Keeps self-hosted add-ons aligned on every boot.
 */

import { eq, notInArray } from 'drizzle-orm'
import { db } from './client.js'
import { addOns } from './schema.js'
import { ADDON_CATALOG, ACTIVE_ADDON_SLUGS } from '../modules/addons/catalog/index.js'

async function seedAddOns() {
  for (const addon of ADDON_CATALOG) {
    const existing = await db.select().from(addOns).where(eq(addOns.slug, addon.slug)).limit(1)

    if (existing.length === 0) {
      await db.insert(addOns).values(addon)
      console.log(`  Created add-on: ${addon.name}`)
    } else {
      await db.update(addOns).set(addon).where(eq(addOns.slug, addon.slug))
      console.log(`  Updated add-on: ${addon.name}`)
    }
  }

  const activeSlugs = Array.from(ACTIVE_ADDON_SLUGS)
  if (activeSlugs.length > 0) {
    await db
      .update(addOns)
      .set({ isActive: false })
      .where(notInArray(addOns.slug, activeSlugs))
  }
}

async function seed() {
  await seedAddOns()
}

export async function runSeed() {
  console.log('Running platform seed...')
  await seed()
  console.log('Seed completed')
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  console.log('Running seed...')
  await seed()
  console.log('Seed completed')
  process.exit(0)
}
