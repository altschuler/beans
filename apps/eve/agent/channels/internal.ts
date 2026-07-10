import {defineChannel, GET, POST} from 'eve/channels'
import {routeAuth} from 'eve/channels/auth'
import {capabilityScopeError, eveServiceCapabilityAuth} from '../lib/service-capability-auth'
import {requireCategorizationRuntimeScope} from '../lib/runtime-scope'
import {sql} from '@penge/domain/db'
import {markRunningAgentWorkflowRunCompleted, markRunningAgentWorkflowRunFailed} from '@penge/domain/workflow-runs'

type CategorizationTaskAuthAttributes = {
  targetBankTransactionIds?: readonly string[]
}

type InternalChannelState = {appRunId: string | null}

export default defineChannel<InternalChannelState, {state: InternalChannelState}>({
  state: {appRunId: null},
  context: state => ({state}),
  events: {
    async 'session.completed'(_event, _channel, ctx) {
      try {
        const scope = requireCategorizationRuntimeScope(ctx)
        await markRunningAgentWorkflowRunCompleted(sql, {id: scope.appRunId})
      } catch (error) {
        console.error('Could not fast-path a completed Eve categorization run', error)
      }
    },
    async 'session.failed'(_event, channel) {
      if (!channel.state.appRunId) return
      try {
        await markRunningAgentWorkflowRunFailed(sql, {id: channel.state.appRunId, error: 'AI categorization failed'})
      } catch (error) {
        console.error('Could not fast-path a failed Eve categorization run', error)
      }
    },
  },
  routes: [
    POST('/categorization/:appRunId', async (request, {send, params}) => {
      const auth = await routeAuth(request, eveServiceCapabilityAuth)
      if (auth instanceof Response) return auth
      const scopeError = capabilityScopeError(auth, {purpose: 'categorization-task', appRunId: params.appRunId ?? ''})
      if (scopeError) return scopeError

      const session = await send(categorizationTaskPrompt(auth.attributes), {
        auth,
        continuationToken: `categorization:${params.appRunId}`,
        state: {appRunId: params.appRunId ?? null},
        mode: 'task',
        title: 'Categorize transactions',
      })

      return Response.json({sessionId: session.id, nextStreamIndex: 0}, {status: 202})
    }),
    GET('/categorization/:appRunId/stream', async (request, {getSession, params}) => {
      const auth = await routeAuth(request, eveServiceCapabilityAuth)
      if (auth instanceof Response) return auth
      const appRunId = params.appRunId ?? ''
      const scopeError = capabilityScopeError(auth, {purpose: 'categorization-trace', appRunId})
      if (scopeError) return scopeError

      const url = new URL(request.url)
      if ([...url.searchParams.keys()].some(key => key !== 'startIndex')) return new Response('Not found', {status: 404})
      const startIndex = parseStreamIndex(url.searchParams.get('startIndex'))
      if (startIndex === null) return new Response('Invalid startIndex', {status: 400})
      const eveSessionId = auth.attributes.eveSessionId
      if (typeof eveSessionId !== 'string' || eveSessionId.length === 0) return new Response('Not found', {status: 404})

      try {
        const session = await getSession(eveSessionId)
        const stream = await session.getEventStream({startIndex})
        return new Response(stream, {
          headers: {
            'cache-control': 'no-store, no-transform',
            'content-type': 'application/x-ndjson; charset=utf-8',
          },
        })
      } catch {
        return new Response('Session not found', {status: 404})
      }
    }),
  ],
})

function parseStreamIndex(value: string | null) {
  if (value === null) return 0
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
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
