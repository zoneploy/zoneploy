import type { FastifyInstance } from 'fastify'
import { serverManagementRoutes } from './server-management.routes.js'
import { serverRuntimeRoutes } from './server-runtime.routes.js'

export async function serverRoutes(app: FastifyInstance) {
  await app.register(serverManagementRoutes)
  await app.register(serverRuntimeRoutes)
}
