import path from 'node:path'
import fs from 'node:fs/promises'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyWebsocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import rawBody from 'fastify-raw-body'
import { sql } from 'drizzle-orm'
import { config } from './config.js'
import { redis } from './lib/redis.js'
import { db } from './db/client.js'
import { AppError } from './lib/errors.js'
import { getHttpClientError } from './lib/http-errors.js'
import { WorkerClientError } from './lib/worker-client.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { organizationRoutes } from './modules/organizations/organizations.routes.js'
import { memberRoutes } from './modules/members/members.routes.js'
import { invitationRoutes, publicInvitationRoutes } from './modules/invitations/invitations.routes.js'
import { projectRoutes } from './modules/projects/projects.routes.js'
import { environmentRoutes } from './modules/environments/environments.routes.js'
import { customRoleRoutes } from './modules/custom-roles/custom-roles.routes.js'
import { auditRoutes } from './modules/audit/audit.routes.js'
import { serverRoutes } from './modules/servers/servers.routes.js'
import { containerRoutes } from './modules/containers/containers.routes.js'
import { secretRoutes } from './modules/secrets/secrets.routes.js'
import { domainRoutes } from './modules/domains/domains.routes.js'
import { planRoutes, subscriptionRoutes } from './modules/plans/plans.routes.js'
import {
  orgAddonRoutes,
  serverAddonRoutes,
  containerAddonBindingRoutes,
  stackAddonBindingRoutes,
} from './modules/addons/addons.routes.js'
import { cleanupAllDeploymentHistory } from './lib/cleanup.js'
import { deployByToken } from './modules/containers/containers.service.js'
import { stackRoutes } from './modules/stacks/stacks.routes.js'
import { notificationRoutes } from './modules/notifications/notifications.routes.js'
import { deployStackByToken } from './modules/stacks/stacks.service.js'
import { createDeployPlan, validateDeployToken } from './modules/deploy/deploy.service.js'
import { runMigrations } from './db/migrate.js'
import { runSeed } from './db/seed.js'

const server = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      config.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              ignore: 'pid,hostname,reqId,responseTime,req,res',
              messageFormat: '{msg} {req.method} {req.url} {res.statusCode} {responseTime}ms',
            },
          }
        : undefined,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
})

// Plugins

const corsOrigins = [
  config.APP_URL,
  ...(config.EXTRA_CORS_ORIGINS ? config.EXTRA_CORS_ORIGINS.split(',').map(o => o.trim()) : []),
]

await server.register(cors, {
  origin: corsOrigins,
  credentials: true,
})

await server.register(cookie)

await server.register(rateLimit, {
  global: false, // Apply only where explicitly configured.
  redis,
  keyGenerator: (req) => req.ip,
})

await server.register(fastifyWebsocket)

// Multipart: organization logo uploads.
await server.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB maximum.
    files: 1,
  },
})

await server.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
})

// Parse text/yaml and text/plain as strings for the stack CI/CD endpoint.
server.addContentTypeParser(['text/yaml', 'text/plain', 'application/yaml'], { parseAs: 'string' }, (_req, body, done) => {
  done(null, body)
})

// Global error handler

server.setErrorHandler((err: Error, _request, reply) => {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
  }

  if (err instanceof WorkerClientError) {
    return reply.status(502).send({ error: { code: 'AGENT_ERROR', message: err.message } })
  }

  const httpError = getHttpClientError(err)
  if (httpError) {
    return reply.status(httpError.statusCode).send({
      error: {
        code: httpError.code,
        message: httpError.message,
      },
    })
  }

  server.log.error(err)
  return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } })
})

// Health check

server.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}))

// Redirect email verification links to the frontend

server.get('/verify-email', async (request, reply) => {
  const { token } = request.query as { token?: string }
  const dest = `${config.APP_URL}/verify-email${token ? `?token=${encodeURIComponent(token)}` : ''}`
  return reply.redirect(dest, 302)
})

// Static logos
// Serves: GET /uploads/org-logos/:filename

server.get('/uploads/org-logos/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string }
  // Only PNG files with safe names.
  if (!/^[\w-]+\.png$/.test(filename)) {
    return reply.status(404).send()
  }
  const filepath = path.join(process.cwd(), 'uploads', 'org-logos', filename)
  try {
    const buffer = await fs.readFile(filepath)
    return reply
      .header('Cache-Control', 'public, max-age=86400')
      .type('image/png')
      .send(buffer)
  } catch {
    return reply.status(404).send()
  }
})

// Routes

// Auth
await server.register(authRoutes, { prefix: '/api/v1/auth' })

// Organizations
await server.register(organizationRoutes, { prefix: '/api/v1/organizations' })
await server.register(memberRoutes, { prefix: '/api/v1/organizations/:orgId/members' })
await server.register(invitationRoutes, { prefix: '/api/v1/organizations/:orgId/invitations' })
await server.register(publicInvitationRoutes, { prefix: '/api/v1/invitations' })
await server.register(customRoleRoutes, { prefix: '/api/v1/organizations/:orgId/roles' })
await server.register(auditRoutes, { prefix: '/api/v1/organizations/:orgId/audit' })

// Projects and environments
await server.register(projectRoutes, { prefix: '/api/v1/organizations/:orgId/projects' })
await server.register(environmentRoutes, { prefix: '/api/v1/organizations/:orgId/projects/:projectId/environments' })

// Infrastructure
await server.register(serverRoutes, { prefix: '/api/v1/organizations/:orgId/servers' })
await server.register(containerRoutes, { prefix: '/api/v1/organizations/:orgId/containers' })
await server.register(secretRoutes, { prefix: '/api/v1/organizations/:orgId/containers/:containerId/secrets' })
await server.register(domainRoutes, { prefix: '/api/v1/organizations/:orgId/containers/:containerId/domain' })
await server.register(stackRoutes, { prefix: '/api/v1/organizations/:orgId/stacks' })

// Add-ons
await server.register(orgAddonRoutes, { prefix: '/api/v1/organizations/:orgId/addons' })
await server.register(serverAddonRoutes, { prefix: '/api/v1/organizations/:orgId/servers/:serverId/addons' })
await server.register(containerAddonBindingRoutes, { prefix: '/api/v1/organizations/:orgId/containers/:containerId/addons' })
await server.register(stackAddonBindingRoutes, { prefix: '/api/v1/organizations/:orgId/stacks/:stackId/addons' })
await server.register(planRoutes, { prefix: '/api/v1/plans' })
await server.register(subscriptionRoutes, { prefix: '/api/v1/organizations/:orgId/subscription' })
await server.register(notificationRoutes, { prefix: '/api/v1/notifications' })

server.post('/api/v1/deploy/plan', async (request, reply) => {
  const auth = request.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } })

  const body = (request.body ?? {}) as {
    target?: 'auto' | 'container' | 'stack'
    image?: string
  }

  try {
    const result = await createDeployPlan(token, {
      target: body.target,
      image: body.image,
    })
    return reply.send(result)
  } catch (err) {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    throw err
  }
})

// Public CI/CD endpoint: POST /api/v1/deploy
// Supports containers (type: "container") and stacks (type: "stack").

server.post('/api/v1/deploy', async (request, reply) => {
  const auth = request.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } })

  const body = (request.body ?? {}) as {
    image?: string
    releaseId?: string
    git?: {
      repository?: string
      ref?: string
      commitSha?: string
      token?: string
      contextPath?: string
      dockerfile?: string
      composeFile?: string
    }
    composeFile?: string   // base64-encoded processed docker-compose.yml without build sections.
  }

  try {
    const resource = await validateDeployToken(token)

    if (resource.type === 'stack') {
      if (!body.composeFile) {
        return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Se requiere "composeFile" (base64) para deploys de tipo stack' } })
      }
      const composeContent = Buffer.from(body.composeFile, 'base64').toString('utf-8')
      const git = body.git?.repository
        ? {
            repository: body.git.repository,
            ref: body.git.ref,
            commitSha: body.git.commitSha,
            token: body.git.token,
            contextPath: body.git.contextPath,
            dockerfile: body.git.dockerfile,
            composeFile: body.git.composeFile,
          }
        : undefined
      const result = await deployStackByToken(token, composeContent, { git, releaseId: body.releaseId })
      return reply.status(202).send(result)
    }

    const git = body.git?.repository
      ? {
          repository: body.git.repository,
          ref: body.git.ref,
          commitSha: body.git.commitSha,
          token: body.git.token,
          contextPath: body.git.contextPath,
          dockerfile: body.git.dockerfile,
          composeFile: body.git.composeFile,
        }
      : undefined

    // container
    const result = await deployByToken(token, { image: body.image, git, releaseId: body.releaseId })
    return reply.status(202).send(result)
  } catch (err) {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    throw err
  }
})

// Legacy CI/CD endpoint: POST /api/v1/stacks/deploy
// Keeps compatibility with workflows that send raw YAML or { composeContent }.

server.post('/api/v1/stacks/deploy', {
  config: { rawBody: true },
}, async (request, reply) => {
  const auth = request.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token requerido' } })

  let composeContent: string | undefined
  const contentType = request.headers['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    composeContent = (request.body as { composeContent?: string }).composeContent
  } else {
    composeContent = typeof request.body === 'string' ? request.body : undefined
  }

  if (!composeContent?.trim()) {
    return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'El contenido del docker-compose.yml es requerido' } })
  }

  try {
    const result = await deployStackByToken(token, composeContent)
    return reply.status(202).send(result)
  } catch (err) {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    throw err
  }
})

// Startup

async function start() {
  try {
    await db.execute(sql`SELECT 1`)
    server.log.info('✔ PostgreSQL conectado')

    await runMigrations()
    server.log.info('✔ Migraciones aplicadas')

    await runSeed()
    server.log.info('✔ Seed verificado')

    await redis.connect()
    server.log.info('✔ Redis conectado')

    await server.listen({ port: config.PORT, host: '0.0.0.0' })
    server.log.info(`▶ Platform corriendo en puerto ${config.PORT}`)

    server.log.info('▶ Offline detector iniciado')

    server.log.info('▶ Operation recovery watchdog iniciado')

    server.log.info('▶ Custom domain TLS reconciler iniciado')

    server.log.info('▶ Stack backup scheduler iniciado')

    const SIX_HOURS = 6 * 60 * 60 * 1000

    cleanupAllDeploymentHistory(20).catch(err => server.log.warn(err, 'Error en cleanup de deployments'))
    setInterval(() => cleanupAllDeploymentHistory(20).catch(err => server.log.warn(err, 'Error en cleanup de deployments')), SIX_HOURS)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
