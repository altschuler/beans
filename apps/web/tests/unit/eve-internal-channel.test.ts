import {describe, expect, it, vi} from 'vitest'
import {mintEveServiceCapability} from '@penge/domain/eve-service-capability'

const secret = 'test-eve-internal-channel-secret-32b'

vi.mock('eve/channels', () => ({
  defineChannel: (config: unknown) => config,
  GET: (path: string, handler: unknown) => ({path, handler}),
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

type MockSession = {getEventStream(options: {startIndex: number}): Promise<ReadableStream>}
type MockRoute = {
  path: string
  handler(request: Request, context: {
    send: (prompt: string, options: unknown) => Promise<{id: string; continuationToken: string}>
    getSession: (sessionId: string) => MockSession
    params: Record<string, string>
  }): Promise<Response>
}

async function internalChannel() {
  vi.resetModules()
  process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET = secret
  return (await import('../../../eve/agent/channels/internal')).default as unknown as {routes: readonly MockRoute[]}
}

async function categorizationRoute() {
  const route = (await internalChannel()).routes.find(route => route.path === '/categorization/:appRunId')
  if (!route) throw new Error('missing categorization route')
  return route
}

function taskToken(scope: {appRunId: string; targetBankTransactionIds?: string[]}, now = new Date()) {
  return mintEveServiceCapability(
    {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', ...scope},
    {secret, now, ttlSeconds: 60},
  )
}

function traceToken(scope: {appRunId: string; eveSessionId: string}, now = new Date()) {
  return mintEveServiceCapability(
    {purpose: 'categorization-trace', teamId: 'team-1', userId: 'user-1', ...scope},
    {secret, now, ttlSeconds: 60},
  )
}

const unusedGetSession = () => {
  throw new Error('getSession should not be called')
}

describe('eve internal channel', () => {
  it('exposes categorization start and trace routes only', async () => {
    const channel = await internalChannel()

    expect(channel.routes.map(route => route.path)).toEqual([
      '/categorization/:appRunId',
      '/categorization/:appRunId/stream',
    ])
  })

  it('derives categorization prompts from verified capability claims instead of request body echoes', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const token = taskToken({appRunId: 'app-run-1', targetBankTransactionIds: ['txn-2', 'txn-1']})

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({appRunId: 'wrong-run', teamId: 'wrong-team', userId: 'wrong-user', targetBankTransactionIds: ['wrong-txn']}),
    }), {send, getSession: unusedGetSession, params: {appRunId: 'app-run-1'}})

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
    }), {send, getSession: unusedGetSession, params: {appRunId: 'other-run'}})

    expect(response.status).toBe(403)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects chat-purpose, expired, and malformed capabilities', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const chatToken = mintEveServiceCapability(
      {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
      {secret, ttlSeconds: 60},
    )
    const expired = taskToken({appRunId: 'app-run-1'}, new Date(Date.now() - 120_000))

    for (const token of [chatToken, expired, 'malformed']) {
      const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
        method: 'POST', headers: {authorization: `Bearer ${token}`},
      }), {send, getSession: unusedGetSession, params: {appRunId: 'app-run-1'}})
      expect([401, 403]).toContain(response.status)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('accepts capabilities minted within the eve channel clock-skew window', async () => {
    const route = await categorizationRoute()
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const token = taskToken({appRunId: 'app-run-1'}, new Date(Date.now() + 20_000))

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
    }), {send, getSession: unusedGetSession, params: {appRunId: 'app-run-1'}})

    expect(response.status).toBe(202)
    expect(send).toHaveBeenCalled()
  })

  it('streams only the session and cursor bound into a read-only trace capability', async () => {
    const channel = await internalChannel()
    const route = channel.routes.find(route => route.path === '/categorization/:appRunId/stream')
    if (!route) throw new Error('missing categorization stream route')
    const stream = new ReadableStream({start(controller) { controller.close() }})
    const getEventStream = vi.fn(async () => stream)
    const getSession = vi.fn(() => ({getEventStream}))
    const token = traceToken({appRunId: 'app-run-1', eveSessionId: 'eve-session-1'})

    const response = await route.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1/stream?startIndex=7', {
      headers: {authorization: `Bearer ${token}`},
    }), {send: vi.fn(), getSession, params: {appRunId: 'app-run-1'}})

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(getSession).toHaveBeenCalledWith('eve-session-1')
    expect(getEventStream).toHaveBeenCalledWith({startIndex: 7})
  })

  it('keeps task-start and trace-read capability purposes disjoint', async () => {
    const channel = await internalChannel()
    const startRoute = channel.routes.find(route => route.path === '/categorization/:appRunId')!
    const streamRoute = channel.routes.find(route => route.path === '/categorization/:appRunId/stream')!
    const send = vi.fn(async () => ({id: 'eve-session-1', continuationToken: 'categorization:app-run-1'}))
    const getSession = vi.fn()

    const traceOnStart = await startRoute.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST', headers: {authorization: `Bearer ${traceToken({appRunId: 'app-run-1', eveSessionId: 'eve-session-1'})}`},
    }), {send, getSession, params: {appRunId: 'app-run-1'}})
    const taskOnStream = await streamRoute.handler(new Request('https://eve.test/eve/v1/internal/categorization/app-run-1/stream', {
      headers: {authorization: `Bearer ${taskToken({appRunId: 'app-run-1'})}`},
    }), {send, getSession, params: {appRunId: 'app-run-1'}})

    expect(traceOnStart.status).toBe(403)
    expect(taskOnStream.status).toBe(403)
    expect(send).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })
})
