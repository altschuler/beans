import type {SessionAuthContext} from 'eve/context'
import {runtimeScopeSchema, type CategorizationRuntimeScope, type ChatRuntimeScope, type RuntimeScope} from './finance-schemas'

type RuntimeContext = {
  session: {
    auth: {
      current: SessionAuthContext | null
    }
  }
}

export function requireRuntimeScope(ctx: RuntimeContext): RuntimeScope {
  const auth = ctx.session.auth.current
  const result = runtimeScopeSchema.safeParse(auth?.attributes)
  if (
    !auth ||
    !result.success ||
    auth.authenticator !== 'penge-web' ||
    auth.principalId !== result.data.userId ||
    auth.principalType !== (result.data.purpose === 'chat-session' ? 'user' : 'service')
  ) {
    throw new Error('Invalid trusted eve runtime scope')
  }
  return result.data
}

export function requireChatRuntimeScope(ctx: RuntimeContext): ChatRuntimeScope {
  const scope = requireRuntimeScope(ctx)
  if (scope.purpose !== 'chat-session') throw new Error('Invalid trusted eve runtime scope')
  return scope
}

export function requireCategorizationRuntimeScope(ctx: RuntimeContext): CategorizationRuntimeScope {
  const scope = requireRuntimeScope(ctx)
  if (scope.purpose !== 'categorization-task') throw new Error('Invalid trusted eve runtime scope')
  return scope
}
