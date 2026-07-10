import {createHmac} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'
import {mintEveServiceCapability} from '@penge/domain/eve-service-capability'
import {routeAuth, type AuthFn} from 'eve/channels/auth'

const secret = 'test-eve-default-channel-secret-32b'

vi.mock('eve/channels/eve', () => ({
  eveChannel: (config: unknown) => config,
}))

type ChannelConfig = {
  auth: AuthFn<Request>
  uploadPolicy: string
}

async function channelConfig() {
  vi.resetModules()
  process.env.PENGE_EVE_SERVICE_CAPABILITY_SECRET = secret
  return (await import('../../../eve/agent/channels/eve')).default as unknown as ChannelConfig
}

function chatToken(now = new Date()) {
  return mintEveServiceCapability(
    {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
    {secret, now, ttlSeconds: 60},
  )
}

function signedMalformedScopeToken() {
  const token = chatToken()
  const [header, encodedPayload] = token.split('.') as [string, string, string]
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>
  delete payload.chatId
  const malformedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signingInput = `${header}.${malformedPayload}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

function taskToken() {
  return mintEveServiceCapability(
    {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', appRunId: 'run-1'},
    {secret, ttlSeconds: 60},
  )
}

async function responseError(result: unknown) {
  return (await (result as Response).json() as {error: string}).error
}

async function authenticate(method: string, path: string, token?: string) {
  const config = await channelConfig()
  const request = new Request(`https://eve.test${path}`, {
    method,
    headers: token ? {authorization: `Bearer ${token}`} : undefined,
  })
  return {config, result: await routeAuth(request, config.auth)}
}

describe('eve default channel', () => {
  it('dispatches a valid start through the installed Eve default-channel protocol route', async () => {
    const config = await channelConfig()
    const actual = await vi.importActual<typeof import('eve/channels/eve')>('eve/channels/eve')
    const channel = actual.eveChannel(config as Parameters<typeof actual.eveChannel>[0]) as unknown as {
      routes: Array<{
        method: string
        path: string
        handler(request: Request, context: {send: (message: unknown, options: unknown) => Promise<{id: string; continuationToken: string}>}): Promise<Response>
      }>
    }
    const send = vi.fn(async (_message: unknown, _options: unknown) => ({
      id: 'eve-session-1',
      continuationToken: 'eve:continuation-1',
    }))
    const route = channel.routes.find(candidate => candidate.method === 'POST' && candidate.path === '/eve/v1/session')
    if (!route) throw new Error('Missing installed Eve start route')

    const response = await route.handler(new Request('https://eve.test/eve/v1/session', {
      method: 'POST',
      headers: {authorization: `Bearer ${chatToken()}`, 'content-type': 'application/json'},
      body: JSON.stringify({message: 'Hello', mode: 'conversation'}),
    }), {send})

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      continuationToken: 'eve:continuation-1',
      ok: true,
      sessionId: 'eve-session-1',
    })
    expect(send).toHaveBeenCalledWith('Hello', expect.objectContaining({
      auth: expect.objectContaining({principalId: 'user-1'}),
      mode: 'conversation',
    }))
  })

  it('stamps valid chat capabilities exactly and disables uploads', async () => {
    const {config, result} = await authenticate('POST', '/eve/v1/session', chatToken())

    expect(config.uploadPolicy).toBe('disabled')
    expect(result).toEqual({
      attributes: {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
      authenticator: 'penge-web',
      principalId: 'user-1',
      principalType: 'user',
      subject: 'user-1',
    })
  })

  it.each([
    ['POST', '/eve/v1/session'],
    ['POST', '/eve/v1/session/eve-session_1'],
    ['POST', `/eve/v1/session/${'s'.repeat(200)}`],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=0'],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=12'],
  ])('admits the exact proxy route %s %s', async (method, path) => {
    const {result} = await authenticate(method, path, chatToken())
    expect(result).not.toBeInstanceOf(Response)
  })

  it.each([
    ['GET', '/eve/v1/info'],
    ['GET', '/eve/v1/health'],
    ['GET', '/eve/v1/session'],
    ['PUT', '/eve/v1/session/eve-session_1'],
    ['POST', '/eve/v1/session/eve-session_1/stream'],
    ['POST', '/eve/v1/session?extra=1'],
    ['POST', '/eve/v1/session/eve-session_1?extra=1'],
    ['POST', `/eve/v1/session/${'s'.repeat(201)}`],
    ['POST', '/eve/v1/session/%65ve-session_1'],
    ['GET', '/eve/v1/session/eve-session_1/stream'],
    ['GET', '/eve/v1/session/eve-session_1/stream?extra=1'],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=1&startIndex=2'],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=01'],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=%30'],
    ['GET', '/eve/v1/session/eve-session_1/stream?startIndex=9007199254740992'],
    ['GET', `/eve/v1/session/${'s'.repeat(201)}/stream?startIndex=0`],
    ['GET', '/eve/v1/session/eve-session%2Fother/stream'],
  ])('rejects non-proxy route %s %s', async (method, path) => {
    const {result} = await authenticate(method, path, chatToken())
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
  })

  it('rejects wrong-purpose, expired, malformed, and missing credentials without fallback auth', async () => {
    const wrongPurpose = await authenticate('POST', '/eve/v1/session', taskToken())
    const expired = await authenticate('POST', '/eve/v1/session', chatToken(new Date(Date.now() - 120_000)))
    const malformed = await authenticate('POST', '/eve/v1/session', 'not-a-capability')
    const malformedScope = await authenticate('POST', '/eve/v1/session', signedMalformedScopeToken())
    const invalidSignature = await authenticate('POST', '/eve/v1/session', `${chatToken()}tampered`)
    const missing = await authenticate('POST', '/eve/v1/session')

    expect((wrongPurpose.result as Response).status).toBe(403)
    expect((expired.result as Response).status).toBe(401)
    expect((malformed.result as Response).status).toBe(401)
    expect((malformedScope.result as Response).status).toBe(401)
    expect((invalidSignature.result as Response).status).toBe(401)
    expect(await Promise.all([
      responseError(expired.result),
      responseError(malformed.result),
      responseError(malformedScope.result),
      responseError(invalidSignature.result),
    ])).toEqual(Array(4).fill('Eve service capability is invalid'))
    expect((missing.result as Response).status).toBe(401)
  })
})
