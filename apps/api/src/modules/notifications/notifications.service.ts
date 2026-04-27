import { eq, and, isNull, desc, lt } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { notifications, type NotificationType } from '../../db/schema.js'
import { NotFoundError } from '../../lib/errors.js'

// Types

export interface CreateNotificationInput {
  userId: string
  orgId?: string | null
  type: NotificationType
  data?: Record<string, unknown>
  link?: string | null
}

// Services

export async function createNotification(input: CreateNotificationInput) {
  const [notif] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      orgId: input.orgId ?? null,
      type: input.type,
      data: input.data ?? {},
      link: input.link ?? null,
    })
    .returning()

  return notif
}

export async function listNotifications(userId: string, limit = 50, offset = 0) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
}

export async function countUnread(userId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

  return rows.length
}

export async function markAsRead(userId: string, notificationId: string) {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning()

  if (!updated) throw new NotFoundError('Notificación no encontrada')
  return updated
}

export async function markAllAsRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

  return { ok: true }
}

export async function deleteNotification(userId: string, notificationId: string) {
  const [deleted] = await db
    .delete(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning()

  if (!deleted) throw new NotFoundError('Notificación no encontrada')
  return { ok: true }
}

// Cleanup: delete read notifications older than 90 days.
export async function purgeOldNotifications() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)

  await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
}
