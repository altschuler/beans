import {describe, expect, it, vi} from 'vitest'
import {mintEveServiceCapability} from '@penge/domain/eve-service-capability'

const secret = 'test-eve-internal-channel-secret-32b'

vi.mock('eve/channels', () => ({
  defineChannel: (config: unknown) => config,
  POST: (path: string, handler: unknown) => ({path, handler}),
}))

vi.mock('eve/channels/auth', () => {
  class UnauthenticatedError extends Error {}

  return {
    UnauthenticatedError,
    createUnauthorizedResponse: ({status, message}: {status: number; message: string}) => new Response(message, {status}),
    extractBearerToken: (header: string | null) => {
      const match = /^Bearer\s+(.+)$/i.exec(header ?? '')
      return match?.[1] ?? null
    },
    routeAuth: async (request: Request, authFn: (request: Request) => unknown) => {
      try {
        return await authFn(request)
      } catch (error) {
        if (error instanceof UnauthenticatedError) return new Response(error.message, {status: 401})
        throw error
      }
    },
  }
})

type MockRoute = {
  path: string
  handler(request: Request, context: {send: (prompt: string, options: unknown) => Promise<{id: string; continuationToken: string}>; params: Record<string, string>}): Promise<Response>
}

async function categorizationRoute() {
  vi.resetModules()
  process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET = secret
  const channel = (await import('../../../eve/agent/channels/internal')).default as unknown as {routes: readonly MockRoute[]}
  const route = channel.routes.find(route => route.path === '/categorization/:appRunId')
  if (!route) throw new Error('missing categorization route')
  return route
}

function taskToken(scope: {appRunId: string; targetBankTransactionIds?: string[]}, now = new Date()) {
  return mintEveServiceCapability(
    {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', ...scope},
    {secret, now, ttlSeconds: 60},
  )
}

describe('eve internal channel', () => {
  it('derives categorization prompts from verified capability claims instead of request body echoes', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const token = taskToken({appRunId: 'app-run-1', targetBankTransactionIds: ['txn-2', 'txn-1']})

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({appRunId: 'wrong-run', teamId: 'wrong-team', userId: 'wrong-user', targetBankTransactionIds: ['wrong-txn']}),
    }), {send, params: {appRunId: 'app-run-1'}})

    expect(response.status).toBe(202)
    expect(send).toHaveBeenCalledWith(expect.stringContaining('Only categorize these bank transactions: txn-2, txn-1.'), expect.objectContaining({
      continuationToken: 'categorization:app-run-1',
      mode: 'task',
    }))
  })

  it('still rejects categorization capabilities for a different app run', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:other-run'}))
    const token = taskToken({appRunId: 'app-run-1'})

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/other-run', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
    }), {send, params: {appRunId: 'other-run'}})

    expect(response.status).toBe(403)
    expect(send).not.toHaveBeenCalled()
  })

  it('accepts capabilities minted within the eve channel clock-skew window', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const token = taskToken({appRunId: 'app-run-1'}, new Date(Date.now() + 20_000))

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
    }), {send, params: {appRunId: 'app-run-1'}})

    expect(response.status).toBe(202)
    expect(send).toHaveBeenCalled()
  })
})
