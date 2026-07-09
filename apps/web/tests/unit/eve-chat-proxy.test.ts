import {describe, expect, it, vi} from 'vitest'

const defaultDeps = () => ({
  getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
  resolveChatScope: vi.fn(async () => ({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})),
  userCanAccessTeam: vi.fn(async () => true),
  mintChatCapability: vi.fn(() => 'chat-capability'),
  storeEveChatSessionState: vi.fn(async () => undefined),
  fetch: vi.fn(async () => new Response(JSON.stringify({sessionId: 'eve-session-1', continuationToken: 'internal:chat:chat-1'}), {status: 202})),
  env: {PENGE_EVE_BASE_URL: 'http://eve.test/'},
})

describe('eve chat proxy', () => {
  it('requires an authenticated session', async () => {
    const deps = defaultDeps()
    deps.getSession.mockResolvedValue(null as never)
    const {createEveChatProxyHandler} = await import('@/eve/eve-chat-proxy.server')
    const handler = createEveChatProxyHandler(deps)

    const response = await handler(new Request('https://app.test/api/eve/chat/chat-1', {method: 'POST'}), {chatId: 'chat-1'})

    expect(response.status).toBe(401)
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('hides unknown, user-mismatched, and inaccessible chats', async () => {
    const {createEveChatProxyHandler} = await import('@/eve/eve-chat-proxy.server')

    const missingDeps = defaultDeps()
    missingDeps.resolveChatScope.mockResolvedValue(null as never)
    expect((await createEveChatProxyHandler(missingDeps)(new Request('https://app.test/api/eve/chat/missing', {method: 'POST'}), {chatId: 'missing'})).status).toBe(404)

    const mismatchedDeps = defaultDeps()
    mismatchedDeps.resolveChatScope.mockResolvedValue({teamId: 'team-1', userId: 'other-user', chatId: 'chat-1'})
    expect((await createEveChatProxyHandler(mismatchedDeps)(new Request('https://app.test/api/eve/chat/chat-1', {method: 'POST'}), {chatId: 'chat-1'})).status).toBe(404)

    const inaccessibleDeps = defaultDeps()
    inaccessibleDeps.userCanAccessTeam.mockResolvedValue(false)
    expect((await createEveChatProxyHandler(inaccessibleDeps)(new Request('https://app.test/api/eve/chat/chat-1', {method: 'POST'}), {chatId: 'chat-1'})).status).toBe(404)
  })

  it('forwards authorized chat sends with a scoped capability and stores returned eve session state', async () => {
    const deps = defaultDeps()
    const {createEveChatProxyHandler} = await import('@/eve/eve-chat-proxy.server')
    const handler = createEveChatProxyHandler(deps)

    const response = await handler(new Request('https://app.test/api/eve/chat/chat-1', {
      method: 'POST',
      headers: {'content-type': 'application/json', cookie: 'session=private'},
      body: JSON.stringify({message: 'hello'}),
    }), {chatId: 'chat-1'})

    expect(response.status).toBe(202)
    expect(deps.mintChatCapability).toHaveBeenCalledWith({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
    expect(deps.fetch).toHaveBeenCalledWith('http://eve.test/eve/v1/internal/chat/chat-1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer chat-capability',
        'content-type': 'application/json',
      },
      body: JSON.stringify({message: 'hello'}),
    })
    expect(deps.storeEveChatSessionState).toHaveBeenCalledWith({
      chatId: 'chat-1',
      teamId: 'team-1',
      userId: 'user-1',
      eveSessionId: 'eve-session-1',
      eveContinuationToken: 'internal:chat:chat-1',
    })
  })

  it('omits stale encoding and length headers after reading decoded upstream responses', async () => {
    const deps = defaultDeps()
    deps.fetch.mockResolvedValue(new Response('plain text', {
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': '999',
      },
    }))
    const {createEveChatProxyHandler} = await import('@/eve/eve-chat-proxy.server')
    const handler = createEveChatProxyHandler(deps)

    const response = await handler(new Request('https://app.test/api/eve/chat/chat-1', {
      method: 'POST',
      body: JSON.stringify({message: 'hello'}),
    }), {chatId: 'chat-1'})

    expect(await response.text()).toBe('plain text')
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.has('content-encoding')).toBe(false)
    expect(response.headers.has('content-length')).toBe(false)
  })
})
