/**
 * Idempotent platform seed.
 * Keeps plans, add-ons, and plan/add-on availability aligned on every boot.
 */

import { and, eq, notInArray } from 'drizzle-orm'
import { db } from './client.js'
import { addOns, planAddOns, plans } from './schema.js'
import { PLAN_CATALOG } from '../modules/plans/plan-catalog.js'
import { ADDON_CATALOG, ACTIVE_ADDON_SLUGS, PLAN_ADDON_MATRIX } from '../modules/addons/catalog/index.js'

async function seedPlans() {
  for (const plan of PLAN_CATALOG) {
    const existing = await db.select().from(plans).where(eq(plans.slug, plan.slug)).limit(1)

    if (existing.length === 0) {
      await db.insert(plans).values(plan)
      console.log(`  Created plan: ${plan.name}`)
    } else {
      await db.update(plans).set(plan).where(eq(plans.slug, plan.slug))
      console.log(`  Updated plan: ${plan.name}`)
    }
  }
}

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

async function seedPlanAddOns() {
  const existingPlans = await db.select({ id: plans.id, slug: plans.slug }).from(plans)
  const existingAddOns = await db.select({ id: addOns.id, slug: addOns.slug }).from(addOns)

  const planIds = new Map(existingPlans.map(plan => [plan.slug, plan.id]))
  const addonIds = new Map(existingAddOns.map(addon => [addon.slug, addon.id]))

  for (const [planSlug, entries] of Object.entries(PLAN_ADDON_MATRIX)) {
    const planId = planIds.get(planSlug)
    if (!planId) continue

    for (const entry of entries) {
      const addOnId = addonIds.get(entry.addonSlug)
      if (!addOnId) continue

      const existing = await db
        .select({ id: planAddOns.id })
        .from(planAddOns)
        .where(and(eq(planAddOns.planId, planId), eq(planAddOns.addOnId, addOnId)))
        .limit(1)

      const payload = {
        planId,
        addOnId,
        limits: entry.limits ?? {},
      }

      if (existing.length === 0) {
        await db.insert(planAddOns).values(payload)
        console.log(`  Linked add-on ${entry.addonSlug} to plan ${planSlug}`)
      } else {
        await db.update(planAddOns).set(payload).where(eq(planAddOns.id, existing[0]!.id))
      }
    }
  }
}

async function seed() {
  await seedPlans()
  await seedAddOns()
  await seedPlanAddOns()
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
