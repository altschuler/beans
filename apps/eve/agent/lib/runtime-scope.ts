import type {SessionAuthContext} from 'eve/context'
import {chatRuntimeScopeSchema, type ChatRuntimeScope} from './finance-schemas'

type RuntimeContext = {
  session: {auth: {current: SessionAuthContext | null}}
}

export function requireChatRuntimeScope(ctx: RuntimeContext): ChatRuntimeScope {
  const auth = ctx.session.auth.current
  const result = chatRuntimeScopeSchema.safeParse(auth?.attributes)
  if (
    !auth || !result.success ||
    auth.authenticator !== 'penge-web' ||
    auth.principalId !== result.data.userId ||
    auth.principalType !== 'user'
  ) throw new Error('Invalid trusted eve runtime scope')
  return result.data
}
