import {defineChannel, POST} from 'eve/channels'
import {
  createUnauthorizedResponse,
  extractBearerToken,
  routeAuth,
  UnauthenticatedError,
  type AuthFn,
} from 'eve/channels/auth'
import type {SessionAuthContext} from 'eve/context'
import {
  EveServiceCapabilityError,
  verifyEveServiceCapability,
  type EveServiceCapabilityClaims,
} from '@penge/domain/eve-service-capability'

type ChatRequestBody = {
  message?: unknown
}

type CategorizationTaskAuthAttributes = {
  targetBankTransactionIds?: readonly string[]
}

export default defineChannel({
  routes: [
    // Spike surface: assumes Ask Penge chat rides this internal channel. The
    // spec's chat-channel spike gate (custom channel vs proxied default eve
    // channel) may replace or remove this route; continuation tokens are
    // channel-namespaced, so browser clients cannot continue these sessions
    // through the default /eve/v1/session* routes.
    POST('/chat/:chatId', async (request, {send, params}) => {
      const auth = await routeAuth(request, serviceCapabilityAuth)
      if (auth instanceof Response) return auth
      const scopeError = requireCapabilityScope(auth, {purpose: 'chat-session', chatId: params.chatId})
      if (scopeError) return scopeError

      const body = await readJson<ChatRequestBody>(request)
      if (!isNonEmptyString(body.message)) return jsonError('message is required', 400)

      const session = await send(body.message, {
        auth,
        continuationToken: `chat:${params.chatId}`,
        mode: 'conversation',
        title: 'Ask Penge',
      })

      return Response.json({ok: true, sessionId: session.id, continuationToken: session.continuationToken})
    }),

    POST('/categorization/:appRunId', async (request, {send, params}) => {
      const auth = await routeAuth(request, serviceCapabilityAuth)
      if (auth instanceof Response) return auth
      const scopeError = requireCapabilityScope(auth, {purpose: 'categorization-task', appRunId: params.appRunId})
      if (scopeError) return scopeError

      const session = await send(categorizationTaskPrompt(auth.attributes), {
        auth,
        continuationToken: `categorization:${params.appRunId}`,
        mode: 'task',
        title: 'Categorize transactions',
      })

      return Response.json({ok: true, sessionId: session.id, continuationToken: session.continuationToken, nextStreamIndex: 0}, {status: 202})
    }),
  ],
})

const serviceCapabilityAuth: AuthFn<Request> = request => {
  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) {
    throw new UnauthenticatedError({
      message: 'Eve service capability bearer token is required',
      challenges: [{scheme: 'Bearer'}],
    })
  }

  try {
    return sessionAuthFromClaims(verifyEveServiceCapability(token, {secret: getCapabilitySecret(), clockSkewSeconds: serviceCapabilityClockSkewSeconds}))
  } catch (error) {
    if (error instanceof EveServiceCapabilityError) throw new UnauthenticatedError({message: error.message})
    throw error
  }
}

function requireCapabilityScope(
  auth: SessionAuthContext,
  expected: {purpose: 'chat-session'; chatId: string | undefined} | {purpose: 'categorization-task'; appRunId: string | undefined},
): Response | null {
  if (expected.purpose === 'chat-session') {
    if (auth.attributes.purpose !== 'chat-session') {
      return createUnauthorizedResponse({status: 403, message: 'Eve chat capability is required'})
    }
    if (!expected.chatId || auth.attributes.chatId !== expected.chatId) {
      return createUnauthorizedResponse({status: 403, message: 'Eve chat capability does not match the requested chat'})
    }
    return null
  }

  if (auth.attributes.purpose !== 'categorization-task') {
    return createUnauthorizedResponse({status: 403, message: 'Eve categorization capability is required'})
  }
  if (!expected.appRunId || auth.attributes.appRunId !== expected.appRunId) {
    return createUnauthorizedResponse({status: 403, message: 'Eve categorization capability does not match the requested app run'})
  }
  return null
}

function sessionAuthFromClaims(claims: EveServiceCapabilityClaims): SessionAuthContext {
  return {
    attributes: {
      purpose: claims.purpose,
      teamId: claims.teamId,
      userId: claims.userId,
      ...(claims.purpose === 'chat-session'
        ? {chatId: claims.chatId}
        : {
            appRunId: claims.appRunId,
            ...(claims.targetBankTransactionIds ? {targetBankTransactionIds: claims.targetBankTransactionIds} : {}),
          }),
    },
    authenticator: 'penge-web',
    principalId: claims.userId,
    principalType: claims.purpose === 'chat-session' ? 'user' : 'service',
    subject: claims.userId,
  }
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object' ? body as T : {} as T
  } catch {
    return {} as T
  }
}

function categorizationTaskPrompt(input: CategorizationTaskAuthAttributes) {
  const targetIds = Array.isArray(input.targetBankTransactionIds) ? input.targetBankTransactionIds : []
  const targetDescription = targetIds.length
    ? `Only categorize these bank transactions: ${targetIds.join(', ')}.`
    : 'Categorize eligible needs-review bank transactions for the trusted team.'

  return [
    'Run the Penge automated categorization task.',
    targetDescription,
    'Use only trusted runtime auth scope from ctx.session.auth. Do not ask the user questions or wait for approval.',
  ].join('\n')
}

function getCapabilitySecret() {
  const secret = process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET
  if (!secret) throw new Error('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  return secret
}

const serviceCapabilityClockSkewSeconds = 30

function jsonError(error: string, status: number) {
  return Response.json({ok: false, error}, {status})
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
