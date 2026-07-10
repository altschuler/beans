import {
  createUnauthorizedResponse,
  extractBearerToken,
  UnauthenticatedError,
  type AuthFn,
} from 'eve/channels/auth'
import type {SessionAuthContext} from 'eve/context'
import {
  EveServiceCapabilityError,
  verifyEveServiceCapability,
  type EveServiceCapabilityClaims,
} from '@penge/domain/eve-service-capability'

export type ExpectedCapabilityScope =
  | {purpose: 'chat-session'; chatId?: string}
  | {purpose: 'categorization-task'; appRunId: string}

export const eveServiceCapabilityAuth: AuthFn<Request> = request => {
  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) {
    throw new UnauthenticatedError({
      message: 'Eve service capability bearer token is required',
      challenges: [{scheme: 'Bearer'}],
    })
  }

  try {
    return sessionAuthFromClaims(verifyEveServiceCapability(token, {
      secret: getCapabilitySecret(),
      clockSkewSeconds: 30,
    }))
  } catch (error) {
    if (error instanceof EveServiceCapabilityError) {
      throw new UnauthenticatedError({message: 'Eve service capability is invalid'})
    }
    throw error
  }
}

export function capabilityMatchesScope(auth: SessionAuthContext, expected: ExpectedCapabilityScope) {
  if (expected.purpose === 'chat-session') {
    return auth.attributes.purpose === 'chat-session' &&
      (expected.chatId === undefined || auth.attributes.chatId === expected.chatId)
  }
  return auth.attributes.purpose === 'categorization-task' && auth.attributes.appRunId === expected.appRunId
}

export function capabilityScopeError(auth: SessionAuthContext, expected: ExpectedCapabilityScope): Response | null {
  if (capabilityMatchesScope(auth, expected)) return null
  const chat = expected.purpose === 'chat-session'
  return createUnauthorizedResponse({
    status: 403,
    message: chat
      ? expected.chatId === undefined
        ? 'Eve chat capability is required'
        : 'Eve chat capability does not match the requested chat'
      : auth.attributes.purpose === 'categorization-task'
        ? 'Eve categorization capability does not match the requested app run'
        : 'Eve categorization capability is required',
  })
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

function getCapabilitySecret() {
  const secret = process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET
  if (!secret) throw new Error('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  return secret
}
