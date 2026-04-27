import { db } from '../db/client.js'
import { auditLogs } from '../db/schema.js'

// Audit action types

export type AuditAction =
  | 'org.created' | 'org.updated' | 'org.deleted' | 'org.logo_updated' | 'org.2fa_toggled' | 'org.2fa_enabled' | 'org.2fa_disabled'
  | 'member.invited' | 'member.joined' | 'member.role_changed' | 'member.removed'
  | 'member.invite_revoked'
  | 'project.created' | 'project.updated' | 'project.deleted'
  | 'environment.created' | 'environment.updated' | 'environment.deleted' | 'environment.protected_toggled'
  | 'container.created' | 'container.updated' | 'container.deleted'
  | 'container.deployed' | 'container.started' | 'container.stopped' | 'container.restarted'
  | 'stack.created' | 'stack.updated' | 'stack.deleted' | 'stack.deployed'
  | 'stack.started' | 'stack.stopped' | 'stack.restarted'
  | 'stack.backup_created' | 'stack.backup_restored' | 'stack.backup_deleted' | 'stack.backup_policy_updated'
  | 'stack.service_started' | 'stack.service_stopped' | 'stack.service_restarted'
  | 'server.connected' | 'server.disconnected' | 'server.updated'
  | 'server.docker_cleanup'
  | 'role.created' | 'role.updated' | 'role.deleted'
  | 'secret.created' | 'secret.updated' | 'secret.deleted'
  | 'env_secret.created' | 'env_secret.updated' | 'env_secret.deleted'
  | 'domain.zoneploy.created' | 'domain.zoneploy.updated' | 'domain.zoneploy.deleted'
  | 'domain.custom.created' | 'domain.custom.updated' | 'domain.custom.deleted' | 'domain.custom.verified'
  | 'addon.installed' | 'addon.configured' | 'addon.backend_action' | 'addon.uninstalled'
  | 'addon.bound' | 'addon.binding_configured' | 'addon.unbound'
  | 'deploy_token.created' | 'deploy_token.deleted'
  | 'plan.changed'

export interface AuditOptions {
  orgId: string
  actor: { id: string; email: string; name: string }
  action: AuditAction
  resourceType: string
  resourceId?: string
  resourceName?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/**
 * Records an action in the audit log.
 * Always fire-and-forget: errors are logged but not propagated.
 */
export async function audit(opts: AuditOptions): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      orgId: opts.orgId,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      actorName: opts.actor.name,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId ?? null,
      resourceName: opts.resourceName ?? null,
      metadata: opts.metadata ?? {},
      ipAddress: opts.ipAddress ?? null,
    })
  } catch (err) {
    // Never fail because of audit logging; only log the error.
    console.error('[audit] Failed to record audit log:', err)
  }
}
