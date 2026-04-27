import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { addOnBindings, addOns, serverAddOnInstallations } from '../../db/schema.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'
import { workerClient } from '../../lib/worker-client.js'
import {
  assertAddonRequirementsCompatible,
  buildAddonActionPayload,
  buildDesiredAddonConfig,
  buildServerAddonConfigurePlan,
  buildServerAddonInstallPlan,
  buildServerAddonUninstallPlan,
  ensureAddonAvailableForPlan,
  ensureServerOwned,
  getAddonDefinition,
  getInstallationRow,
  normalizeAddonRequirements,
  normalizeBindingScopes,
  normalizeServerAddonSnapshot,
  persistAgentManagedState,
  refreshServerPreflightSnapshot,
  rethrowAgentAddonError,
  syncInstallationFromAgent,
  type AgentManagedAddonState,
} from './addon-shared.js'

export async function getOrgAddons(orgId: string) {
  void orgId

  const available = await db
    .select({
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      capabilities: addOns.capabilities,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
      isActive: addOns.isActive,
    })
    .from(addOns)
    .where(eq(addOns.isActive, true))
    .orderBy(addOns.category, addOns.name)

  return available.map(row => ({
    ...row,
    limits: {},
    bindingScopes: normalizeBindingScopes(row.bindingScopes),
    requirements: normalizeAddonRequirements(row.requirements),
  }))
}

export async function getServerAddons(orgId: string, serverId: string) {
  const initialServer = await ensureServerOwned(orgId, serverId)
  const server = await refreshServerPreflightSnapshot(initialServer)

  const [rows, counts] = await Promise.all([
    db
      .select({
        id: serverAddOnInstallations.id,
        serverId: serverAddOnInstallations.serverId,
        orgId: serverAddOnInstallations.orgId,
        addOnId: serverAddOnInstallations.addOnId,
        status: serverAddOnInstallations.status,
        version: serverAddOnInstallations.version,
        config: serverAddOnInstallations.config,
        capabilities: serverAddOnInstallations.capabilities,
        health: serverAddOnInstallations.health,
        createdAt: serverAddOnInstallations.createdAt,
        updatedAt: serverAddOnInstallations.updatedAt,
        name: addOns.name,
        slug: addOns.slug,
        description: addOns.description,
        category: addOns.category,
        controlPlane: addOns.controlPlane,
        installationScope: addOns.installationScope,
        bindingScopes: addOns.bindingScopes,
        requirements: addOns.requirements,
        managedComponents: addOns.managedComponents,
        uiMetadata: addOns.uiMetadata,
      })
      .from(serverAddOnInstallations)
      .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
      .where(and(
        eq(serverAddOnInstallations.orgId, orgId),
        eq(serverAddOnInstallations.serverId, serverId),
        isNull(serverAddOnInstallations.deletedAt),
      ))
      .orderBy(addOns.category, addOns.name),
    db
      .select({
        installationId: addOnBindings.serverAddOnInstallationId,
        value: count(),
      })
      .from(addOnBindings)
      .innerJoin(
        serverAddOnInstallations,
        eq(addOnBindings.serverAddOnInstallationId, serverAddOnInstallations.id),
      )
      .where(
        and(
          eq(serverAddOnInstallations.orgId, orgId),
          eq(serverAddOnInstallations.serverId, serverId),
          eq(addOnBindings.status, 'active'),
          isNull(serverAddOnInstallations.deletedAt),
          isNull(addOnBindings.deletedAt),
        ),
      )
      .groupBy(addOnBindings.serverAddOnInstallationId),
  ])

  const countMap = new Map(counts.map(entry => [entry.installationId, entry.value]))

  await Promise.all(
    rows.map(row =>
      syncInstallationFromAgent(row.id, server, {
        slug: row.slug,
        capabilities: row.capabilities as Record<string, unknown>,
      }),
    ),
  )

  const refreshedRows = await db
    .select({
      id: serverAddOnInstallations.id,
      serverId: serverAddOnInstallations.serverId,
      orgId: serverAddOnInstallations.orgId,
      addOnId: serverAddOnInstallations.addOnId,
      status: serverAddOnInstallations.status,
      version: serverAddOnInstallations.version,
      config: serverAddOnInstallations.config,
      capabilities: serverAddOnInstallations.capabilities,
      health: serverAddOnInstallations.health,
      createdAt: serverAddOnInstallations.createdAt,
      updatedAt: serverAddOnInstallations.updatedAt,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
    })
    .from(serverAddOnInstallations)
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(and(
      eq(serverAddOnInstallations.orgId, orgId),
      eq(serverAddOnInstallations.serverId, serverId),
      isNull(serverAddOnInstallations.deletedAt),
    ))
    .orderBy(addOns.category, addOns.name)

  return {
    server: normalizeServerAddonSnapshot(server),
    installations: refreshedRows.map(row => ({
      ...row,
      bindingScopes: normalizeBindingScopes(row.bindingScopes),
      requirements: normalizeAddonRequirements(row.requirements),
      bindingCount: countMap.get(row.id) ?? 0,
    })),
  }
}

export async function installServerAddon(orgId: string, serverId: string, addonId: string) {
  const initialServer = await ensureServerOwned(orgId, serverId)
  const addon = await ensureAddonAvailableForPlan(orgId, addonId)
  const existing = await getInstallationRow(orgId, serverId, addonId)
  const server = await refreshServerPreflightSnapshot(initialServer)
  assertAddonRequirementsCompatible(addon, server)
  const installPlan = buildServerAddonInstallPlan({
    addonSlug: addon.slug,
    serverStatus: server.status,
    existingStatus: existing?.status ?? null,
  })
  const desiredConfig = buildDesiredAddonConfig(
    addon.slug,
    server,
    (existing?.config ?? {}) as Record<string, unknown>,
  )

  if (existing) {
    const [reactivated] = await db
      .update(serverAddOnInstallations)
      .set({
        status: installPlan.installationStatus,
        config: desiredConfig,
        capabilities: addon.capabilities,
        updatedAt: new Date(),
      })
      .where(eq(serverAddOnInstallations.id, existing.id))
      .returning()

    if (!reactivated) throw new NotFoundError('Server add-on installation not found')

    if (installPlan.shouldCallAgent) {
      let state: AgentManagedAddonState
      try {
        state = await workerClient.installAddon(server, addon.slug, desiredConfig)
      } catch (error) {
        rethrowAgentAddonError(error)
      }
      return persistAgentManagedState(reactivated.id, addon.capabilities as Record<string, unknown>, state)
    }

    return reactivated
  }

  const [installation] = await db
    .insert(serverAddOnInstallations)
    .values({
      serverId,
      orgId,
      addOnId: addonId,
      status: installPlan.installationStatus,
      config: desiredConfig,
      capabilities: addon.capabilities,
      health: {},
    })
    .returning()

  if (!installation) throw new ValidationError('The add-on could not be installed')

  if (installPlan.shouldCallAgent) {
    let state: AgentManagedAddonState
    try {
      state = await workerClient.installAddon(server, addon.slug, desiredConfig)
    } catch (error) {
      rethrowAgentAddonError(error)
    }
    return persistAgentManagedState(installation.id, addon.capabilities as Record<string, unknown>, state)
  }

  return installation
}

export async function configureServerAddon(
  orgId: string,
  serverId: string,
  addonId: string,
  config: Record<string, unknown>,
) {
  const server = await ensureServerOwned(orgId, serverId)
  const existing = await getInstallationRow(orgId, serverId, addonId)
  if (!existing) throw new NotFoundError('The add-on is not installed on this server')

  const addon = await getAddonDefinition(addonId)
  const configurePlan = buildServerAddonConfigurePlan({
    addonSlug: addon.slug,
    serverStatus: server.status,
  })
  const resetToDefaults = config.resetToDefaults === true
  const overrides = { ...config }
  delete overrides.resetToDefaults
  const desiredConfig = buildDesiredAddonConfig(
    addon.slug,
    server,
    resetToDefaults
      ? overrides
      : {
          ...(existing.config as Record<string, unknown>),
          ...overrides,
        },
  )

  if (configurePlan.shouldCallAgent) {
    let state: AgentManagedAddonState
    try {
      state = await workerClient.configureAddon(server, addon.slug, desiredConfig)
    } catch (error) {
      rethrowAgentAddonError(error)
    }
    return persistAgentManagedState(existing.id, addon.capabilities as Record<string, unknown>, state)
  }

  const [updated] = await db
    .update(serverAddOnInstallations)
    .set({ config: desiredConfig, updatedAt: new Date() })
    .where(eq(serverAddOnInstallations.id, existing.id))
    .returning()

  return updated
}

export async function runServerAddonAction(
  orgId: string,
  serverId: string,
  addonId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const server = await ensureServerOwned(orgId, serverId)
  const existing = await getInstallationRow(orgId, serverId, addonId)
  if (!existing || existing.status !== 'active') {
    throw new NotFoundError('The add-on is not installed on this server')
  }

  const addon = await getAddonDefinition(addonId)
  const configurePlan = buildServerAddonConfigurePlan({
    addonSlug: addon.slug,
    serverStatus: server.status,
  })

  if (!configurePlan.shouldCallAgent) {
    throw new ValidationError('This add-on does not support server-side actions')
  }

  let state: AgentManagedAddonState
  const actionPayload = buildAddonActionPayload(addon.slug, server, action, payload)
  try {
    state = await workerClient.runAddonAction(server, addon.slug, action, actionPayload)
  } catch (error) {
    rethrowAgentAddonError(error)
  }

  return persistAgentManagedState(existing.id, addon.capabilities as Record<string, unknown>, state)
}

export async function uninstallServerAddon(
  orgId: string,
  serverId: string,
  addonId: string,
  options?: { force?: boolean; deletedByUserId?: string | null; deleteReason?: string | null },
) {
  const force = options?.force === true
  const server = await ensureServerOwned(orgId, serverId)
  const existing = await getInstallationRow(orgId, serverId, addonId)
  if (!existing) throw new NotFoundError('The add-on is not installed on this server')

  const addon = await getAddonDefinition(addonId)
  const uninstallPlan = buildServerAddonUninstallPlan({
    addonSlug: addon.slug,
    serverStatus: server.status,
    force,
  })

  if (uninstallPlan.shouldCallAgent) {
    try {
      await workerClient.uninstallAddon(server, addon.slug)
    } catch (error) {
      rethrowAgentAddonError(error)
    }
  }

  await Promise.all([
    db
      .update(addOnBindings)
      .set({
        status: 'disabled',
        deletedAt: new Date(),
        deletedByUserId: options?.deletedByUserId ?? null,
        deleteReason: options?.deleteReason ?? 'addon_uninstalled',
        updatedAt: new Date(),
      })
      .where(and(
        eq(addOnBindings.serverAddOnInstallationId, existing.id),
        isNull(addOnBindings.deletedAt),
      )),
    db
      .update(serverAddOnInstallations)
      .set({
        status: 'disabled',
        deletedAt: new Date(),
        deletedByUserId: options?.deletedByUserId ?? null,
        deleteReason: options?.deleteReason ?? 'addon_uninstalled',
        updatedAt: new Date(),
      })
      .where(eq(serverAddOnInstallations.id, existing.id)),
  ])
}
