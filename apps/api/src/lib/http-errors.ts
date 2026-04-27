interface HttpErrorLike {
  statusCode?: unknown
  code?: unknown
  message?: unknown
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
}

export function getHttpClientError(err: unknown) {
  const candidate = err as HttpErrorLike
  const statusCode = candidate.statusCode
  if (!Number.isInteger(statusCode) || (statusCode as number) < 400 || (statusCode as number) >= 500) {
    return null
  }

  const code = typeof candidate.code === 'string' && candidate.code
    ? candidate.code
    : DEFAULT_CODES[statusCode as number] ?? 'HTTP_ERROR'

  const message = typeof candidate.message === 'string' && candidate.message
    ? candidate.message
    : 'Request rejected'

  return {
    statusCode: statusCode as number,
    code,
    message,
  }
}
