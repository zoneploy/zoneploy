import type { FastifyInstance } from 'fastify'
import type { Permission } from '@zoneploy/types'
import { AppError } from '../../lib/errors.js'
import { audit as defaultAudit } from '../../lib/audit.js'
import { authenticate as defaultAuthenticate } from '../../plugins/authenticate.js'
import { authorize as defaultAuthorize } from '../../plugins/authorize.js'
import {
  bindAddonToOwner as defaultBindAddonToOwner,
  configureAddonBinding as defaultConfigureAddonBinding,
  configureServerAddon as defaultConfigureServerAddon,
  getAddonAuditContext as defaultGetAddonAuditContext,
  getAddonBindingAuditContext as defaultGetAddonBindingAuditContext,
  getAvailableBindingsForOwner as defaultGetAvailableBindingsForOwner,
  getInstallationAddonAuditContext as defaultGetInstallationAddonAuditContext,
  getOrgAddons as defaultGetOrgAddons,
  getOwnerAddonBindings as defaultGetOwnerAddonBindings,
  getServerAddons as defaultGetServerAddons,
  installServerAddon as defaultInstallServerAddon,
  runServerAddonAction as defaultRunServerAddonAction,
  unbindAddonFromOwner as defaultUnbindAddonFromOwner,
  uninstallServerAddon as defaultUninstallServerAddon,
} from './addons.service.js'

interface AddonRouteDeps {
  authenticate?: typeof defaultAuthenticate
  authorize?: typeof defaultAuthorize
  getOrgAddons?: typeof defaultGetOrgAddons
  getServerAddons?: typeof defaultGetServerAddons
  installServerAddon?: typeof defaultInstallServerAddon
  configureServerAddon?: typeof defaultConfigureServerAddon
  runServerAddonAction?: typeof defaultRunServerAddonAction
  uninstallServerAddon?: typeof defaultUninstallServerAddon
  getAddonAuditContext?: typeof defaultGetAddonAuditContext
  getInstallationAddonAuditContext?: typeof defaultGetInstallationAddonAuditContext
  getAddonBindingAuditContext?: typeof defaultGetAddonBindingAuditContext
  getOwnerAddonBindings?: typeof defaultGetOwnerAddonBindings
  getAvailableBindingsForOwner?: typeof defaultGetAvailableBindingsForOwner
  bindAddonToOwner?: typeof defaultBindAddonToOwner
  configureAddonBinding?: typeof defaultConfigureAddonBinding
  unbindAddonFromOwner?: typeof defaultUnbindAddonFromOwner
  audit?: typeof defaultAudit
}

function handleAppError(reply: { status: (code: number) => { send: (payload: unknown) => unknown } }, err: unknown) {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

function allow(
  authorize: typeof defaultAuthorize,
  permission: Permission,
  fallbackRole: Parameters<typeof defaultAuthorize>[0],
) {
  return authorize.permission?.(permission) ?? authorize(fallbackRole)
}

export async function orgAddonRoutes(app: FastifyInstance, options: { deps?: AddonRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    getOrgAddons: defaultGetOrgAddons,
    audit: defaultAudit,
    ...options.deps,
  }

  app.get('/', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:read', 'viewer')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string }
    try {
      return reply.send(await deps.getOrgAddons(orgId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })
}

export async function serverAddonRoutes(app: FastifyInstance, options: { deps?: AddonRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    getServerAddons: defaultGetServerAddons,
    installServerAddon: defaultInstallServerAddon,
    configureServerAddon: defaultConfigureServerAddon,
    runServerAddonAction: defaultRunServerAddonAction,
    uninstallServerAddon: defaultUninstallServerAddon,
    getAddonAuditContext: defaultGetAddonAuditContext,
    audit: defaultAudit,
    ...options.deps,
  }

  app.get('/', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, serverId } = req.params as { orgId: string; serverId: string }
    try {
      return reply.send(await deps.getServerAddons(orgId, serverId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.post('/:addonId', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:connect', 'admin')] }, async (req, reply) => {
    const { orgId, serverId, addonId } = req.params as { orgId: string; serverId: string; addonId: string }
    try {
      const installation = await deps.installServerAddon(orgId, serverId, addonId)
      const addon = await deps.getAddonAuditContext(orgId, addonId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.installed',
        resourceType: 'addon',
        resourceId: addonId,
        resourceName: addon.name,
        metadata: { serverId, installationId: installation.id, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.status(201).send(installation)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.patch('/:addonId', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:connect', 'admin')] }, async (req, reply) => {
    const { orgId, serverId, addonId } = req.params as { orgId: string; serverId: string; addonId: string }
    const config = req.body as Record<string, unknown>
    try {
      const installation = await deps.configureServerAddon(orgId, serverId, addonId, config)
      const addon = await deps.getAddonAuditContext(orgId, addonId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.configured',
        resourceType: 'addon',
        resourceId: addonId,
        resourceName: addon.name,
        metadata: { serverId, installationId: installation?.id, addonSlug: addon.slug, resetToDefaults: config.resetToDefaults === true },
        ipAddress: req.ip,
      })
      return reply.send(installation)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.post('/:addonId/actions/:action', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:connect', 'admin')] }, async (req, reply) => {
    const { orgId, serverId, addonId, action } = req.params as { orgId: string; serverId: string; addonId: string; action: string }
    const payload = (req.body ?? {}) as Record<string, unknown>
    try {
      const installation = await deps.runServerAddonAction(orgId, serverId, addonId, action, payload)
      const addon = await deps.getAddonAuditContext(orgId, addonId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.backend_action',
        resourceType: 'addon',
        resourceId: addonId,
        resourceName: addon.name,
        metadata: { serverId, installationId: installation?.id, addonSlug: addon.slug, action, payload },
        ipAddress: req.ip,
      })
      return reply.send(installation)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.delete('/:addonId', { preHandler: [deps.authenticate, allow(deps.authorize, 'servers:connect', 'admin')] }, async (req, reply) => {
    const { orgId, serverId, addonId } = req.params as { orgId: string; serverId: string; addonId: string }
    const { force } = req.query as { force?: string }
    try {
      const addon = await deps.getAddonAuditContext(orgId, addonId)
      await deps.uninstallServerAddon(orgId, serverId, addonId, {
        force: force === 'true',
        deletedByUserId: req.userId,
        deleteReason: 'addon_uninstalled',
      })
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.uninstalled',
        resourceType: 'addon',
        resourceId: addonId,
        resourceName: addon.name,
        metadata: { serverId, addonSlug: addon.slug, force: force === 'true' },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleAppError(reply, err)
    }
  })
}

export async function containerAddonBindingRoutes(app: FastifyInstance, options: { deps?: AddonRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    getOwnerAddonBindings: defaultGetOwnerAddonBindings,
    getAvailableBindingsForOwner: defaultGetAvailableBindingsForOwner,
    bindAddonToOwner: defaultBindAddonToOwner,
    configureAddonBinding: defaultConfigureAddonBinding,
    unbindAddonFromOwner: defaultUnbindAddonFromOwner,
    getInstallationAddonAuditContext: defaultGetInstallationAddonAuditContext,
    getAddonBindingAuditContext: defaultGetAddonBindingAuditContext,
    audit: defaultAudit,
    ...options.deps,
  }

  app.get('/', { preHandler: [deps.authenticate, allow(deps.authorize, 'containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.getOwnerAddonBindings(orgId, 'container', containerId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.get('/available', { preHandler: [deps.authenticate, allow(deps.authorize, 'containers:read', 'viewer')] }, async (req, reply) => {
    const { orgId, containerId } = req.params as { orgId: string; containerId: string }
    try {
      return reply.send(await deps.getAvailableBindingsForOwner(orgId, 'container', containerId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.post('/:installationId/bind', { preHandler: [deps.authenticate, allow(deps.authorize, 'containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, installationId } = req.params as { orgId: string; containerId: string; installationId: string }
    const config = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      const addon = await deps.getInstallationAddonAuditContext(orgId, installationId)
      const binding = await deps.bindAddonToOwner(orgId, 'container', containerId, installationId, config)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.bound',
        resourceType: 'addon_binding',
        resourceId: binding.id,
        resourceName: addon.name,
        metadata: { ownerType: 'container', ownerId: containerId, installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.status(201).send(binding)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.patch('/bindings/:bindingId', { preHandler: [deps.authenticate, allow(deps.authorize, 'containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, bindingId } = req.params as { orgId: string; containerId: string; bindingId: string }
    const config = req.body as Record<string, unknown>
    try {
      const addon = await deps.getAddonBindingAuditContext(orgId, 'container', containerId, bindingId)
      const binding = await deps.configureAddonBinding(orgId, 'container', containerId, bindingId, config)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.binding_configured',
        resourceType: 'addon_binding',
        resourceId: bindingId,
        resourceName: addon.name,
        metadata: { ownerType: 'container', ownerId: containerId, installationId: addon.installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.send(binding)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.delete('/bindings/:bindingId', { preHandler: [deps.authenticate, allow(deps.authorize, 'containers:write', 'member')] }, async (req, reply) => {
    const { orgId, containerId, bindingId } = req.params as { orgId: string; containerId: string; bindingId: string }
    try {
      const addon = await deps.getAddonBindingAuditContext(orgId, 'container', containerId, bindingId)
      await deps.unbindAddonFromOwner(orgId, 'container', containerId, bindingId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.unbound',
        resourceType: 'addon_binding',
        resourceId: bindingId,
        resourceName: addon.name,
        metadata: { ownerType: 'container', ownerId: containerId, installationId: addon.installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleAppError(reply, err)
    }
  })
}

export async function stackAddonBindingRoutes(app: FastifyInstance, options: { deps?: AddonRouteDeps } = {}) {
  const deps = {
    authenticate: defaultAuthenticate,
    authorize: defaultAuthorize,
    getOwnerAddonBindings: defaultGetOwnerAddonBindings,
    getAvailableBindingsForOwner: defaultGetAvailableBindingsForOwner,
    bindAddonToOwner: defaultBindAddonToOwner,
    configureAddonBinding: defaultConfigureAddonBinding,
    unbindAddonFromOwner: defaultUnbindAddonFromOwner,
    getInstallationAddonAuditContext: defaultGetInstallationAddonAuditContext,
    getAddonBindingAuditContext: defaultGetAddonBindingAuditContext,
    audit: defaultAudit,
    ...options.deps,
  }

  app.get('/', { preHandler: [deps.authenticate, allow(deps.authorize, 'stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.getOwnerAddonBindings(orgId, 'stack', stackId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.get('/available', { preHandler: [deps.authenticate, allow(deps.authorize, 'stacks:read', 'viewer')] }, async (req, reply) => {
    const { orgId, stackId } = req.params as { orgId: string; stackId: string }
    try {
      return reply.send(await deps.getAvailableBindingsForOwner(orgId, 'stack', stackId))
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.post('/:installationId/bind', { preHandler: [deps.authenticate, allow(deps.authorize, 'stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, installationId } = req.params as { orgId: string; stackId: string; installationId: string }
    const config = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      const addon = await deps.getInstallationAddonAuditContext(orgId, installationId)
      const binding = await deps.bindAddonToOwner(orgId, 'stack', stackId, installationId, config)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.bound',
        resourceType: 'addon_binding',
        resourceId: binding.id,
        resourceName: addon.name,
        metadata: { ownerType: 'stack', ownerId: stackId, installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.status(201).send(binding)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.patch('/bindings/:bindingId', { preHandler: [deps.authenticate, allow(deps.authorize, 'stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, bindingId } = req.params as { orgId: string; stackId: string; bindingId: string }
    const config = req.body as Record<string, unknown>
    try {
      const addon = await deps.getAddonBindingAuditContext(orgId, 'stack', stackId, bindingId)
      const binding = await deps.configureAddonBinding(orgId, 'stack', stackId, bindingId, config)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.binding_configured',
        resourceType: 'addon_binding',
        resourceId: bindingId,
        resourceName: addon.name,
        metadata: { ownerType: 'stack', ownerId: stackId, installationId: addon.installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.send(binding)
    } catch (err) {
      return handleAppError(reply, err)
    }
  })

  app.delete('/bindings/:bindingId', { preHandler: [deps.authenticate, allow(deps.authorize, 'stacks:write', 'member')] }, async (req, reply) => {
    const { orgId, stackId, bindingId } = req.params as { orgId: string; stackId: string; bindingId: string }
    try {
      const addon = await deps.getAddonBindingAuditContext(orgId, 'stack', stackId, bindingId)
      await deps.unbindAddonFromOwner(orgId, 'stack', stackId, bindingId)
      deps.audit({
        orgId,
        actor: { id: req.userId, email: req.userEmail, name: req.userName },
        action: 'addon.unbound',
        resourceType: 'addon_binding',
        resourceId: bindingId,
        resourceName: addon.name,
        metadata: { ownerType: 'stack', ownerId: stackId, installationId: addon.installationId, addOnId: addon.addOnId, addonSlug: addon.slug },
        ipAddress: req.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleAppError(reply, err)
    }
  })
}
