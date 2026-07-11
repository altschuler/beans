import {extractBearerToken, UnauthenticatedError, type AuthFn} from 'eve/channels/auth'
import type {SessionAuthContext} from 'eve/context'
import {EveServiceCapabilityError, verifyEveServiceCapability} from '@penge/domain/eve-service-capability'

export const eveServiceCapabilityAuth: AuthFn<Request> = request => {
  const token = extractBearerToken(request.headers.get('authorization'))
  if (!token) throw new UnauthenticatedError({
    message: 'Eve service capability bearer token is required',
    challenges: [{scheme: 'Bearer'}],
  })
  try {
    const claims = verifyEveServiceCapability(token, {
      secret: getCapabilitySecret(),
      clockSkewSeconds: 30,
    })
    return {
      attributes: {
        purpose: 'chat-session',
        teamId: claims.teamId,
        userId: claims.userId,
        chatId: claims.chatId,
      },
      authenticator: 'penge-web',
      principalId: claims.userId,
      principalType: 'user',
      subject: claims.userId,
    } satisfies SessionAuthContext
  } catch (error) {
    if (error instanceof EveServiceCapabilityError) {
      throw new UnauthenticatedError({message: 'Eve service capability is invalid'})
    }
    throw error
  }
}

function getCapabilitySecret() {
  const secret = process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET
  if (!secret) throw new Error('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  return secret
}
