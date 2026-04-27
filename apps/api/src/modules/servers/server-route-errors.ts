import { AppError } from '../../lib/errors.js'

export function handleServerRouteError(
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
  }

  throw error
}
