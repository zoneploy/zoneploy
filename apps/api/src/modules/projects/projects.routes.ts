import type { FastifyInstance } from 'fastify'
import { CreateProjectSchema, UpdateProjectSchema } from '@zoneploy/types'
import { listProjects, getProject, createProject, updateProject, deleteProject } from './projects.service.js'
import { authenticate } from '../../plugins/authenticate.js'
import { authorize } from '../../plugins/authorize.js'
import { AppError } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'

export async function projectRoutes(app: FastifyInstance) {

  // GET /organizations/:orgId/projects
  app.get('/', { preHandler: [authenticate, authorize.permission('projects:read')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    return reply.send(await listProjects(orgId))
  })

  // GET /organizations/:orgId/projects/:projectId
  app.get('/:projectId', { preHandler: [authenticate, authorize.permission('projects:read')] }, async (request, reply) => {
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }

    try {
      return reply.send(await getProject(orgId, projectId))
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // POST /organizations/:orgId/projects
  app.post('/', { preHandler: [authenticate, authorize.permission('projects:create')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }

    const input = CreateProjectSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' },
      })
    }

    try {
      const result = await createProject(orgId, input.data)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'project.created',
        resourceType: 'project',
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

  // PATCH /organizations/:orgId/projects/:projectId
  app.patch('/:projectId', { preHandler: [authenticate, authorize.permission('projects:update')] }, async (request, reply) => {
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }

    const input = UpdateProjectSchema.safeParse(request.body)
    if (!input.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: input.error.errors[0]?.message ?? 'Datos inválidos' },
      })
    }

    try {
      const result = await updateProject(orgId, projectId, input.data)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'project.updated',
        resourceType: 'project',
        resourceId: projectId,
        resourceName: result.name,
        metadata: input.data,
        ipAddress: request.ip,
      })

      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // DELETE /organizations/:orgId/projects/:projectId
  app.delete('/:projectId', { preHandler: [authenticate, authorize.permission('projects:delete')] }, async (request, reply) => {
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }

    try {
      const project = await getProject(orgId, projectId)
      await deleteProject(orgId, projectId)

      await audit({
        orgId,
        actor: { id: request.userId, email: request.userEmail, name: request.userName },
        action: 'project.deleted',
        resourceType: 'project',
        resourceId: projectId,
        resourceName: project.name,
        ipAddress: request.ip,
      })

      return reply.status(204).send()
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
