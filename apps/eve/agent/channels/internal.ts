import {defineChannel, POST} from 'eve/channels'
import {routeAuth} from 'eve/channels/auth'
import {capabilityScopeError, eveServiceCapabilityAuth} from '../lib/service-capability-auth'

type CategorizationTaskAuthAttributes = {
  targetBankTransactionIds?: readonly string[]
}

export default defineChannel({
  routes: [
    POST('/categorization/:appRunId', async (request, {send, params}) => {
      const auth = await routeAuth(request, eveServiceCapabilityAuth)
      if (auth instanceof Response) return auth
      const scopeError = capabilityScopeError(auth, {purpose: 'categorization-task', appRunId: params.appRunId ?? ''})
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
