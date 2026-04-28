import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { UpdateOrgSchema } from '@zoneploy/types'
import {
  getOrg, updateOrg, updateOrgLogo, deleteOrgLogo,
  listUserOrgs, createOrg, deleteOrg,
} from './organizations.service.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'
import { config } from '../../config.js'

// Directory where logos are stored.
const LOGOS_DIR = path.join(process.cwd(), 'uploads', 'org-logos')
const LOGO_MAX_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(buffer: Buffer) {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

export async function organizationRoutes(app: FastifyInstance) {

  // POST /organizations: create organization
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { name } = request.body as { name?: string }

    if (!name || name.trim().length < 2) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Name must be at least 2 characters' },
      })
    }

    try {
      const result = await createOrg(request.userId, name.trim())

      await audit({
        orgId: result.id,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'org.created',
        resourceType: 'organization',
        resourceId: result.id,
        resourceName: result.name,
        ipAddress: request.ip,
      })

      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // GET /organizations: list user organizations
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      return reply.send(await listUserOrgs(request.userId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // GET /organizations/:orgId
  app.get('/:orgId', { preHandler: [authenticate] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    try {
      return reply.send(await getOrg(orgId, request.userId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // PATCH /organizations/:orgId: update name / require2fa
  app.patch(
    '/:orgId',
    { preHandler: [authenticate, authorize.permission('organization:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }

      const input = UpdateOrgSchema.safeParse(request.body)
      if (!input.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Invalid data' },
        })
      }
      try {
        const result = await updateOrg(orgId, input.data)

        if (input.data.name !== undefined) {
          await audit({
            orgId,
            actor: { id: request.userId, email: request.userEmail, name: request.userName },
            action: 'org.updated',
            resourceType: 'organization',
            resourceId: orgId,
            resourceName: result.name,
            metadata: { name: input.data.name },
            ipAddress: request.ip,
          })
        }

        // Audit the semantic 2FA state so security logs remain explicit.
        if (input.data.require2fa !== undefined) {
          await audit({
            orgId,
            actor: { id: request.userId, email: request.userEmail, name: request.userName },
            action: input.data.require2fa ? 'org.2fa_enabled' : 'org.2fa_disabled',
            resourceType: 'organization',
            resourceId: orgId,
            resourceName: result.name,
            metadata: { require2fa: input.data.require2fa },
            ipAddress: request.ip,
          })
        }

        return reply.send(result)
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        }
        throw err
      }
    },
  )

  // POST /organizations/:orgId/logo: upload logo
  // Accepts only PNG files and normalizes them before storing.
  app.post(
    '/:orgId/logo',
    { preHandler: [authenticate, authorize.permission('organization:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }

      const data = await request.file({ limits: { fileSize: LOGO_MAX_BYTES } })
      if (!data) {
        return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'No file was received' } })
      }

      const submittedFilename = data.filename.toLowerCase()
      if (data.mimetype !== 'image/png' && !submittedFilename.endsWith('.png')) {
        return reply.status(400).send({
          error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG files are accepted' },
        })
      }

      try {
        const buffer = await data.toBuffer()

        if (buffer.byteLength > LOGO_MAX_BYTES) {
          return reply.status(400).send({
            error: { code: 'FILE_TOO_LARGE', message: 'The file cannot exceed 512 KB' },
          })
        }

        if (!isPng(buffer)) {
          return reply.status(400).send({
            error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG files are accepted' },
          })
        }

        let normalized: Buffer
        try {
          normalized = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer()
        } catch {
          return reply.status(400).send({
            error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG files are accepted' },
          })
        }

        if (normalized.byteLength > LOGO_MAX_BYTES) {
          return reply.status(400).send({
            error: { code: 'FILE_TOO_LARGE', message: 'The optimized file cannot exceed 512 KB' },
          })
        }

        await fs.mkdir(LOGOS_DIR, { recursive: true })

        const filename = `${orgId}.png`
        const filepath = path.join(LOGOS_DIR, filename)
        await fs.writeFile(filepath, normalized)
        await fs.unlink(path.join(LOGOS_DIR, `${orgId}.svg`)).catch(() => null)

        const logoUrl = `${config.PLATFORM_URL}/uploads/org-logos/${filename}?t=${Date.now()}`
        const result = await updateOrgLogo(orgId, logoUrl, filename)

        await audit({
          orgId,
          actor: { id: request.userId, email: request.userEmail, name: request.userName },
          action: 'org.logo_updated',
          resourceType: 'organization',
          resourceId: orgId,
          ipAddress: request.ip,
        })

        return reply.send(result)
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        }
        throw err
      }
    },
  )

  // DELETE /organizations/:orgId/logo: delete logo
  app.delete(
    '/:orgId/logo',
    { preHandler: [authenticate, authorize.permission('organization:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }

      await Promise.all([
        fs.unlink(path.join(LOGOS_DIR, `${orgId}.png`)).catch(() => null),
        fs.unlink(path.join(LOGOS_DIR, `${orgId}.svg`)).catch(() => null),
      ])

      await deleteOrgLogo(orgId)
      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'org.logo_updated',
        resourceType: 'organization',
        resourceId: orgId,
        metadata: { removed: true },
        ipAddress: request.ip,
      })
      return reply.status(204).send()
    },
  )

  // DELETE /organizations/:orgId: delete org (owner only)
  app.delete(
    '/:orgId',
    { preHandler: [authenticate, authorize('owner')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string }

      try {
        await deleteOrg(orgId, request.userId)

        await audit({
          orgId,
          actor: { id: request.userId, email: request.userEmail, name: request.userName },
          action: 'org.deleted',
          resourceType: 'organization',
          resourceId: orgId,
          ipAddress: request.ip,
        })

        return reply.status(204).send()
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        }
        throw err
      }
    },
  )
}
