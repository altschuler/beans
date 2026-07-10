import {describe, expect, it, vi} from 'vitest'
import {createEveChatProxyHandler} from '@/eve/eve-chat-proxy.server'
import type {ChatFollowUpDeliveryAcknowledgementResult} from '@/eve/chat-runtime-repository.server'

const appOrigin = 'https://app.test'
const chatHost = `${appOrigin}/api/eve/chat/chat-1`
const startPath = '/eve/v1/session'
const sessionId = 'eve-session-1'
const continuationToken = 'continuation-1'

type ApprovalRow = {
  requestId: string
  callId: string
  toolName: string
  projectionStatus: 'ready' | 'blocked'
  resolutionStatus: 'pending'
}

function runtimeMapping(overrides: Record<string, unknown> = {}) {
  return {
    chatId: 'chat-1',
    teamId: 'team-1',
    userId: 'user-1',
    eveSessionId: null,
    eveContinuationToken: null,
    sessionOrdinal: 0,
    eveNextStreamIndex: 0,
    sessionState: 'none' as const,
    turnStartedAt: null,
    admissionId: null,
    followUpDeliveryState: 'none' as const,
    followUpPreTurnCursor: null,
    ...overrides,
  }
}

function defaultDeps() {
  const reservedStart = runtimeMapping({
    sessionOrdinal: 1,
    sessionState: 'admitting',
    admissionId: 'admission-1',
    turnStartedAt: new Date('2026-07-10T12:00:00.000Z'),
  })
  const deps = {
    getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
    getAuthorizedChatRuntimeMapping: vi.fn(async () => runtimeMapping()),
    reserveChatSessionStart: vi.fn(async () => reservedStart),
    reserveChatFollowUp: vi.fn(async () => runtimeMapping({
      eveSessionId: sessionId,
      eveContinuationToken: continuationToken,
      sessionOrdinal: 1,
      eveNextStreamIndex: 4,
      sessionState: 'running',
      turnStartedAt: new Date('2026-07-10T12:01:00.000Z'),
      admissionId: 'follow-up-admission-1',
      followUpDeliveryState: 'pending',
      followUpPreTurnCursor: 4,
    })),
    attachChatSessionStart: vi.fn(async () => runtimeMapping({
      eveSessionId: sessionId,
      eveContinuationToken: continuationToken,
      sessionOrdinal: 1,
      sessionState: 'running',
    })),
    releaseDefinitiveChatStartRejection: vi.fn(async () => true),
    releaseDefinitiveChatFollowUpRejection: vi.fn(async () => true),
    markChatFollowUpDeliveryAcknowledged: vi.fn(async (): Promise<ChatFollowUpDeliveryAcknowledgementResult> => ({status: 'acknowledged'})),
    markChatFollowUpDeliveryAmbiguous: vi.fn(async () => true),
    reapStaleChatAdmissions: vi.fn(async (): Promise<Array<{chatId: string; sessionOrdinal: number; admissionId: string | null}>> => []),
    listPendingChatApprovals: vi.fn(async (): Promise<ApprovalRow[]> => []),
    claimChatApprovalResponses: vi.fn(async () => ({status: 'claimed' as const})),
    currentChatSessionHasCommittedTerminalBoundary: vi.fn(async () => false),
    mintChatCapability: vi.fn(() => 'chat-capability'),
    reconcileChatRuntime: vi.fn(async () => ({status: 'boundary' as const, boundary: 'session.completed', nextStreamIndex: 0})),
    fetch: vi.fn<typeof fetch>(async () => Response.json({
      ok: true,
      sessionId,
      continuationToken,
    }, {status: 202})),
    createTimeoutSignal: vi.fn((_ms: number) => new AbortController().signal),
    sleep: vi.fn(async (_ms: number) => undefined),
    warn: vi.fn(),
    env: {
      PENGE_EVE_BASE_URL: 'http://eve.test/',
      VITE_PUBLIC_APP_URL: `${appOrigin}/app`,
    },
  }
  return deps
}

function post(path: string, body: unknown = {message: 'hello'}, headers: HeadersInit = {}) {
  return new Request(`${chatHost}${path}`, {
    method: 'POST',
    headers: {origin: appOrigin, 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers))},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function followUpMapping(overrides: Record<string, unknown> = {}) {
  return runtimeMapping({
    eveSessionId: sessionId,
    eveContinuationToken: continuationToken,
    sessionOrdinal: 1,
    eveNextStreamIndex: 4,
    sessionState: 'waiting',
    ...overrides,
  })
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1',
    callId: 'call-1',
    toolName: 'manageCategory',
    projectionStatus: 'ready' as const,
    resolutionStatus: 'pending' as const,
    ...overrides,
  }
}

describe('eve chat proxy route and request boundary', () => {
  it('requires Better Auth and hides inaccessible chats', async () => {
    const unauthenticated = defaultDeps()
    unauthenticated.getSession.mockResolvedValue(null as never)
    expect((await createEveChatProxyHandler(unauthenticated)(post(startPath), {chatId: 'chat-1'})).status).toBe(401)
    expect(unauthenticated.fetch).not.toHaveBeenCalled()

    const inaccessible = defaultDeps()
    inaccessible.getAuthorizedChatRuntimeMapping.mockResolvedValue(null as never)
    expect((await createEveChatProxyHandler(inaccessible)(post(startPath), {chatId: 'chat-1'})).status).toBe(404)
    expect(inaccessible.fetch).not.toHaveBeenCalled()
  })

  it('permits only the exact start, follow-up, and canonical stream route matrix', async () => {
    const allowed = [
      ['POST', `${chatHost}/eve/v1/session`, 202],
      ['POST', `${chatHost}/eve/v1/session/${sessionId}`, 200],
      ['GET', `${chatHost}/eve/v1/session/${sessionId}/stream?startIndex=0`, 200],
    ] as const
    for (const [method, url, status] of allowed) {
      const deps = defaultDeps()
      if (url.includes(sessionId)) deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      if (method === 'POST' && url.endsWith(sessionId)) {
        deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
      } else if (method === 'GET') {
        deps.fetch.mockResolvedValue(new Response('', {headers: {'content-type': 'application/x-ndjson'}}))
      }
      const request = new Request(url, {
        method,
        headers: method === 'POST' ? {origin: appOrigin, 'content-type': 'application/json'} : undefined,
        body: method === 'POST' ? JSON.stringify({message: 'hello'}) : undefined,
      })
      expect((await createEveChatProxyHandler(deps)(request, {chatId: 'chat-1'})).status).toBe(status)
    }

    const rejected = [
      ['GET', '/eve/v1/session'],
      ['PUT', '/eve/v1/session'],
      ['POST', '/eve/v1/session/'],
      ['POST', '/eve/v1/session/../info'],
      ['POST', '/eve/v1/session/%2e%2e/info'],
      ['POST', '/eve/v1/session/eve%2Fsession'],
      ['POST', '/eve/v1/session/eve%5Csession'],
      ['POST', '/eve/v1/session/eve-session/extra'],
      ['GET', `/eve/v1/session/${sessionId}/stream`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=00`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=-1`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=1.0`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=9007199254740992`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=0&startIndex=0`],
      ['GET', `/eve/v1/session/${sessionId}/stream?startIndex=0&other=1`],
      ['GET', '/eve/v1/info'],
      ['GET', '/health'],
      ['POST', '/eve/v1/callback'],
      ['POST', '/eve/v1/upload'],
      ['POST', '/.well-known/workflow/test'],
    ] as const
    for (const [method, path] of rejected) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      const request = new Request(`${chatHost}${path}`, {
        method,
        headers: method === 'POST' ? {origin: appOrigin, 'content-type': 'application/json'} : undefined,
        body: method === 'POST' ? JSON.stringify({message: 'hello'}) : undefined,
      })
      expect((await createEveChatProxyHandler(deps)(request, {chatId: 'chat-1'})).status, `${method} ${path}`).toBe(404)
      expect(deps.fetch, `${method} ${path}`).not.toHaveBeenCalled()
    }
  })

  it('requires one exact configured Origin on POST without trusting proxy headers or Referer', async () => {
    for (const origin of [undefined, 'null', 'not a url', `${appOrigin}, ${appOrigin}`, 'https://foreign.test', `${appOrigin}/path`]) {
      const deps = defaultDeps()
      const headers = new Headers({'content-type': 'application/json', host: 'app.test', referer: `${appOrigin}/app`, 'x-forwarded-host': 'app.test'})
      if (origin !== undefined) headers.set('origin', origin)
      const request = new Request(`${chatHost}${startPath}`, {method: 'POST', headers, body: JSON.stringify({message: 'hello'})})
      expect((await createEveChatProxyHandler(deps)(request, {chatId: 'chat-1'})).status, String(origin)).toBe(403)
      expect(deps.fetch).not.toHaveBeenCalled()
    }

    const deps = defaultDeps()
    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
  })

  it('rejects browser authorization and Penge identity/service headers instead of forwarding them', async () => {
    for (const header of ['authorization', 'x-penge-user-id', 'x-penge-team-id', 'x-penge-service-token']) {
      const deps = defaultDeps()
      const response = await createEveChatProxyHandler(deps)(post(startPath, {message: 'hello'}, {[header]: 'browser-value'}), {chatId: 'chat-1'})
      expect(response.status, header).toBe(400)
      expect(deps.fetch, header).not.toHaveBeenCalled()
    }
  })

  it('sets no-store on early authentication, routing, validation, conflict, and configuration outcomes', async () => {
    const cases: Array<Promise<Response>> = []

    const unauthorized = defaultDeps()
    unauthorized.getSession.mockResolvedValue(null as never)
    cases.push(createEveChatProxyHandler(unauthorized)(post(startPath), {chatId: 'chat-1'}))

    const missing = defaultDeps()
    missing.getAuthorizedChatRuntimeMapping.mockResolvedValue(null as never)
    cases.push(createEveChatProxyHandler(missing)(post(startPath), {chatId: 'chat-1'}))

    const invalid = defaultDeps()
    cases.push(createEveChatProxyHandler(invalid)(post(startPath, {message: 'hello'}, {authorization: 'browser'}), {chatId: 'chat-1'}))

    const conflict = defaultDeps()
    conflict.reserveChatSessionStart.mockResolvedValue(null as never)
    cases.push(createEveChatProxyHandler(conflict)(post(startPath), {chatId: 'chat-1'}))

    const unavailable = defaultDeps()
    unavailable.env.PENGE_EVE_BASE_URL = ''
    cases.push(createEveChatProxyHandler(unavailable)(post(startPath), {chatId: 'chat-1'}))

    for (const response of await Promise.all(cases)) {
      expect([400, 401, 404, 409, 503]).toContain(response.status)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('rejects invalid eve/app configuration before reserving a turn', async () => {
    for (const baseUrl of ['', 'ftp://eve.test', 'http://user:pass@eve.test', 'http://eve.test/path', 'http://eve.test?query=1', 'http://eve.test#fragment']) {
      const deps = defaultDeps()
      deps.env.PENGE_EVE_BASE_URL = baseUrl
      expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status, baseUrl).toBe(503)
      expect(deps.reserveChatSessionStart).not.toHaveBeenCalled()
    }
    const deps = defaultDeps()
    deps.env.VITE_PUBLIC_APP_URL = 'not a URL'
    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(503)
  })
})

describe('eve chat proxy body boundary', () => {
  it('enforces the complete 64 KiB raw-body limit before JSON parsing', async () => {
    const deps = defaultDeps()
    const exact = JSON.stringify({message: 'a'.repeat(20_000), padding: 'x'.repeat(45_500)})
    expect(new TextEncoder().encode(exact).byteLength).toBeLessThanOrEqual(65_536)
    expect((await createEveChatProxyHandler(deps)(post(startPath, exact), {chatId: 'chat-1'})).status).toBe(400)

    const tooLargeDeps = defaultDeps()
    const tooLarge = `{"message":"hello","padding":"${'x'.repeat(65_536)}"}`
    expect((await createEveChatProxyHandler(tooLargeDeps)(post(startPath, tooLarge), {chatId: 'chat-1'})).status).toBe(413)
    expect(tooLargeDeps.reserveChatSessionStart).not.toHaveBeenCalled()
  })

  it('reads fragmented raw bodies, preserves multibyte byte boundaries, and rejects invalid UTF-8 or misleading lengths', async () => {
    const fragmented = defaultDeps()
    const fragmentedBytes = new TextEncoder().encode(JSON.stringify({message: 'fragmented hello'}))
    expect((await createEveChatProxyHandler(fragmented)(streamingPost(fragmentedBytes, 1), {chatId: 'chat-1'})).status).toBe(202)

    const baseBody = {message: '€'.repeat(20_000), clientContext: {currentPage: 'transactions', padding: ''}}
    const baseBytes = new TextEncoder().encode(JSON.stringify(baseBody))
    const exactBody = {
      ...baseBody,
      clientContext: {...baseBody.clientContext, padding: 'x'.repeat(65_536 - baseBytes.byteLength)},
    }
    const exactBytes = new TextEncoder().encode(JSON.stringify(exactBody))
    expect(exactBytes.byteLength).toBe(65_536)
    const exact = defaultDeps()
    expect((await createEveChatProxyHandler(exact)(streamingPost(exactBytes, 7), {chatId: 'chat-1'})).status).toBe(202)

    const invalidUtf8 = defaultDeps()
    const invalidBytes = Uint8Array.from([...new TextEncoder().encode('{"message":"'), 0xff, ...new TextEncoder().encode('"}')])
    expect((await createEveChatProxyHandler(invalidUtf8)(streamingPost(invalidBytes, 2), {chatId: 'chat-1'})).status).toBe(400)
    expect(invalidUtf8.reserveChatSessionStart).not.toHaveBeenCalled()

    const misleadingLength = defaultDeps()
    const oversized = new TextEncoder().encode(JSON.stringify({message: 'hello', padding: 'x'.repeat(65_536)}))
    expect((await createEveChatProxyHandler(misleadingLength)(streamingPost(oversized, 1024, {'content-length': '1'}), {chatId: 'chat-1'})).status).toBe(413)
    expect(misleadingLength.reserveChatSessionStart).not.toHaveBeenCalled()
  })

  it('accepts only a strict nonblank start message of at most 20,000 characters', async () => {
    for (const body of [
      null,
      [],
      {},
      {message: ''},
      {message: '   '},
      {message: 'x'.repeat(20_001)},
      {message: ['text']},
      {message: 'hello', inputResponses: [{requestId: 'r', optionId: 'approve'}]},
      {message: 'hello', continuationToken},
      {message: 'hello', files: []},
      {message: 'hello', data: 'secret'},
      {message: 'hello', teamId: 'team-1'},
      {message: 'hello', userId: 'user-1'},
      {message: 'hello', chatId: 'chat-1'},
      {message: 'hello', outputSchema: {}},
      {message: 'hello', mode: 'task'},
      {message: 'hello', callback: {}},
      {message: 'hello', headers: {}},
      {message: 'hello', signal: {}},
      {message: 'hello', unknown: true},
    ]) {
      const deps = defaultDeps()
      expect((await createEveChatProxyHandler(deps)(post(startPath, body), {chatId: 'chat-1'})).status, JSON.stringify(body)?.slice(0, 100)).toBe(400)
      expect(deps.fetch).not.toHaveBeenCalled()
    }

    const deps = defaultDeps()
    expect((await createEveChatProxyHandler(deps)(post(startPath, {message: 'x'.repeat(20_000)}), {chatId: 'chat-1'})).status).toBe(202)
  })

  it('reconstructs only known currentPage context and drops malformed or unknown context', async () => {
    const known = defaultDeps()
    await createEveChatProxyHandler(known)(post(startPath, {
      message: 'where am I?',
      clientContext: {currentPage: 'transactions', teamId: 'attacker', nested: {secret: true}},
    }), {chatId: 'chat-1'})
    expect(JSON.parse(String(known.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      message: 'where am I?',
      clientContext: {currentPage: 'transactions'},
    })

    for (const clientContext of [{currentPage: 'unknown'}, {currentPage: 1}, 'transactions', ['transactions'], null]) {
      const deps = defaultDeps()
      await createEveChatProxyHandler(deps)(post(startPath, {message: 'hello', clientContext}), {chatId: 'chat-1'})
      expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({message: 'hello'})
    }
  })

  it('accepts strict bounded follow-up messages and approval responses, but requires at least one', async () => {
    const validBodies = [
      {message: 'next'},
      {inputResponses: [{requestId: 'request-1', optionId: 'deny'}]},
      {message: 'context too', inputResponses: [{requestId: 'request-1', optionId: 'approve'}]},
    ]
    for (const body of validBodies) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([approval()])
      deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
      expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, body), {chatId: 'chat-1'})).status).toBe(200)
    }

    for (const body of [
      {},
      {message: '   '},
      {inputResponses: []},
      {inputResponses: [{requestId: '', optionId: 'approve'}]},
      {inputResponses: [{requestId: 'r'.repeat(201), optionId: 'approve'}]},
      {inputResponses: [{requestId: 'request-1', optionId: 'yes'}]},
      {inputResponses: [{requestId: 'request-1', optionId: 'approve', text: 'approve'}]},
      {inputResponses: Array.from({length: 21}, (_, index) => ({requestId: `request-${index}`, optionId: 'deny'}))},
      {message: 'next', unknown: true},
    ]) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, body), {chatId: 'chat-1'})).status, JSON.stringify(body)?.slice(0, 100)).toBe(400)
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })
})

describe('eve chat proxy admission and upstream outcomes', () => {
  it('reaps stale admissions before a new start and logs no orphan details', async () => {
    const deps = defaultDeps()
    deps.reapStaleChatAdmissions.mockResolvedValue([{chatId: 'secret-chat', sessionOrdinal: 9, admissionId: 'secret-admission'}])

    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
    expect(deps.reapStaleChatAdmissions).toHaveBeenCalledOnce()
    expect(deps.warn).toHaveBeenCalledWith('Reaped stale Eve chat admissions', {count: 1})
    expect(JSON.stringify(deps.warn.mock.calls)).not.toContain('secret-chat')
    expect(JSON.stringify(deps.warn.mock.calls)).not.toContain('secret-admission')
  })

  it('reconciles a mapped terminal session before attempting its guarded replacement admission', async () => {
    const deps = defaultDeps()
    const terminal = followUpMapping({sessionState: 'completed'})
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(terminal)
    deps.currentChatSessionHasCommittedTerminalBoundary.mockResolvedValue(true)

    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
    expect(deps.currentChatSessionHasCommittedTerminalBoundary).toHaveBeenCalledWith({
      chatId: 'chat-1', eveSessionId: sessionId, sessionOrdinal: 1, state: 'completed',
    })
    expect(deps.reconcileChatRuntime).toHaveBeenCalledWith(terminal)
    expect(deps.reconcileChatRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reserveChatSessionStart.mock.invocationCallOrder[0]!,
    )
  })

  it('always reconciles a terminal mapping and reserves only after the refreshed exact boundary is committed', async () => {
    const deps = defaultDeps()
    const terminal = followUpMapping({sessionState: 'completed', eveNextStreamIndex: 7})
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(terminal)
    deps.currentChatSessionHasCommittedTerminalBoundary.mockResolvedValue(true)

    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
    expect(deps.reconcileChatRuntime).toHaveBeenCalledWith(terminal)
    expect(deps.currentChatSessionHasCommittedTerminalBoundary).toHaveBeenCalledWith({
      chatId: 'chat-1', eveSessionId: sessionId, sessionOrdinal: 1, state: 'completed',
    })
    expect(deps.reconcileChatRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      deps.currentChatSessionHasCommittedTerminalBoundary.mock.invocationCallOrder[0]!,
    )
    expect(deps.currentChatSessionHasCommittedTerminalBoundary.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reserveChatSessionStart.mock.invocationCallOrder[0]!,
    )
    expect(deps.reserveChatSessionStart).toHaveBeenCalledWith({
      chatId: 'chat-1',
      expectedTerminal: {
        eveSessionId: sessionId,
        sessionOrdinal: 1,
        sessionState: 'completed',
        eveNextStreamIndex: 7,
      },
    })
  })

  it('does not reserve when terminal reconciliation refreshes to a different current mapping', async () => {
    const deps = defaultDeps()
    const terminal = followUpMapping({sessionState: 'completed', eveNextStreamIndex: 7})
    deps.getAuthorizedChatRuntimeMapping
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(followUpMapping({eveSessionId: 'replacement-session', sessionOrdinal: 2, sessionState: 'running'}))

    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(409)
    expect(deps.reconcileChatRuntime).toHaveBeenCalledWith(terminal)
    expect(deps.reserveChatSessionStart).not.toHaveBeenCalled()
  })

  it('reserves once, forwards only reconstructed JSON with a fresh capability, and attaches captured start handles', async () => {
    const deps = defaultDeps()
    const handler = createEveChatProxyHandler(deps)
    const response = await handler(post(startPath, {message: 'hello'}), {chatId: 'chat-1'})

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ok: true, sessionId, continuationToken})
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-eve-session-id')).toBe(sessionId)
    expect(deps.reserveChatSessionStart).toHaveBeenCalledOnce()
    expect(deps.mintChatCapability).toHaveBeenCalledWith({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
    expect(deps.fetch).toHaveBeenCalledWith('http://eve.test/eve/v1/session', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {'content-type': 'application/json', authorization: 'Bearer chat-capability'},
      body: JSON.stringify({message: 'hello'}),
      signal: expect.any(AbortSignal),
    }))
    expect(deps.attachChatSessionStart).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'admission-1', eveSessionId: sessionId,
      eveContinuationToken: continuationToken,
    }))
  })

  it('returns a conflict without calling Eve when start or follow-up CAS loses', async () => {
    const start = defaultDeps()
    start.reserveChatSessionStart.mockResolvedValue(null as never)
    expect((await createEveChatProxyHandler(start)(post(startPath), {chatId: 'chat-1'})).status).toBe(409)
    expect(start.fetch).not.toHaveBeenCalled()

    const follow = defaultDeps()
    follow.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    follow.reserveChatFollowUp.mockResolvedValue(null as never)
    expect((await createEveChatProxyHandler(follow)(post(`${startPath}/${sessionId}`, {message: 'next'}), {chatId: 'chat-1'})).status).toBe(409)
    expect(follow.fetch).not.toHaveBeenCalled()
  })

  it('requires the current session, waiting state, and exact optional continuation token', async () => {
    for (const [pathId, mapping, body] of [
      ['other-session', followUpMapping(), {message: 'next'}],
      [sessionId, followUpMapping({sessionState: 'running'}), {message: 'next'}],
      [sessionId, followUpMapping(), {message: 'next', continuationToken: 'wrong'}],
    ] as const) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(mapping as never)
      const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${pathId}`, body), {chatId: 'chat-1'})
      expect(response.status).toBe(pathId === 'other-session' ? 404 : 409)
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })

  it('substitutes the stored continuation token and validates the follow-up response session', async () => {
    const deps = defaultDeps()
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
      message: 'next', continuationToken,
    }), {chatId: 'chat-1'})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ok: true, sessionId})
    expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({message: 'next', continuationToken})
    await expect(deps.reserveChatFollowUp.mock.results[0]!.value).resolves.toMatchObject({
      followUpDeliveryState: 'pending', admissionId: 'follow-up-admission-1', followUpPreTurnCursor: 4,
    })
    expect(deps.reserveChatFollowUp.mock.invocationCallOrder[0]).toBeLessThan(deps.fetch.mock.invocationCallOrder[0]!)
    expect(deps.markChatFollowUpDeliveryAcknowledged).toHaveBeenCalledWith({
      chatId: 'chat-1', eveSessionId: sessionId, sessionOrdinal: 1,
      admissionId: 'follow-up-admission-1', preTurnCursor: 4,
    })

    const mismatch = defaultDeps()
    mismatch.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    mismatch.fetch.mockResolvedValue(Response.json({ok: true, sessionId: 'other-session'}))
    expect((await createEveChatProxyHandler(mismatch)(post(`${startPath}/${sessionId}`, {message: 'next'}), {chatId: 'chat-1'})).status).toBe(502)
    expect(mismatch.releaseDefinitiveChatFollowUpRejection).not.toHaveBeenCalled()
  })

  it('retries validated receipt acknowledgement through browser abort until the exact marker is durable', async () => {
    const deps = defaultDeps()
    const browser = new AbortController()
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    deps.markChatFollowUpDeliveryAcknowledged
      .mockImplementationOnce(async () => {
        browser.abort(new DOMException('browser disconnected', 'AbortError'))
        throw new Error('raw database acknowledgement failure')
      })
      .mockResolvedValueOnce({status: 'acknowledged'})
    const request = new Request(`${chatHost}${startPath}/${sessionId}`, {
      method: 'POST',
      headers: {origin: appOrigin, 'content-type': 'application/json'},
      body: JSON.stringify({message: 'next'}),
      signal: browser.signal,
    })

    const response = await createEveChatProxyHandler(deps)(request, {chatId: 'chat-1'})

    expect(response.status).toBe(200)
    expect(browser.signal.aborted).toBe(true)
    expect(deps.markChatFollowUpDeliveryAcknowledged).toHaveBeenCalledTimes(2)
    expect(deps.sleep).toHaveBeenCalledWith(50)
    expect(await response.text()).not.toContain('raw database')
    expect(deps.releaseDefinitiveChatFollowUpRejection).not.toHaveBeenCalled()
  })

  it('fails closed without a success handle when receipt acknowledgement finds a stale mapping', async () => {
    const deps = defaultDeps()
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    deps.markChatFollowUpDeliveryAcknowledged.mockResolvedValue({status: 'stale'})

    const response = await createEveChatProxyHandler(deps)(
      post(`${startPath}/${sessionId}`, {message: 'next'}),
      {chatId: 'chat-1'},
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('x-eve-session-id')).toBeNull()
    expect(deps.markChatFollowUpDeliveryAcknowledged).toHaveBeenCalledOnce()
    expect(deps.sleep).not.toHaveBeenCalled()
  })

  it('releases only documented strict Eve pre-admission 4xx receipts', async () => {
    for (const status of [400, 401, 403, 404]) {
      const deps = defaultDeps()
      const receipt = status === 401 || status === 403
        ? {ok: false, error: 'Documented rejection.', code: status === 401 ? 'unauthorized' : 'forbidden'}
        : {ok: false, error: 'Documented rejection.'}
      deps.fetch.mockResolvedValue(streamingResponse(JSON.stringify(receipt), status, 1))
      const response = await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})
      expect(response.status).toBe(status)
      expect(await response.text()).not.toContain('Documented rejection')
      expect(deps.releaseDefinitiveChatStartRejection).toHaveBeenCalledOnce()
    }

    const follow = defaultDeps()
    follow.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    follow.fetch.mockResolvedValue(streamingResponse(JSON.stringify({ok: false, error: 'Session not found.'}), 404, 2))
    expect((await createEveChatProxyHandler(follow)(post(`${startPath}/${sessionId}`, {message: 'next'}), {chatId: 'chat-1'})).status).toBe(404)
    expect(follow.releaseDefinitiveChatFollowUpRejection).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1', eveSessionId: sessionId, sessionOrdinal: 1,
    }))
  })

  it('retains leases for timeout-like, undocumented, malformed, HTML, invalid UTF-8, and oversized 4xx receipts', async () => {
    let oversizedCancelled = false
    const ambiguousResponses = [
      ...[408, 409, 413, 415, 422, 425, 429, 499].map(status =>
        streamingResponse(JSON.stringify({ok: false, error: 'Ambiguous rejection.'}), status, 3)),
      streamingResponse('<html>gateway rejection</html>', 400, 4),
      streamingResponse(JSON.stringify({ok: false, error: 'extra', details: {raw: true}}), 400, 5),
      streamingResponse(JSON.stringify({ok: true, error: 'wrong discriminator'}), 400, 2),
      streamingByteResponse(Uint8Array.from([0xff]), 400, 1),
      streamingResponse(
        JSON.stringify({ok: false, error: 'x'.repeat(9_000)}),
        400,
        128,
        () => { oversizedCancelled = true },
      ),
    ]
    for (const upstream of ambiguousResponses) {
      const deps = defaultDeps()
      deps.fetch.mockResolvedValue(upstream)
      const response = await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})
      expect(response.status).toBe(502)
      expect(deps.releaseDefinitiveChatStartRejection).not.toHaveBeenCalled()
    }
    expect(oversizedCancelled).toBe(true)
  })

  it('byte-bounds and strictly validates fragmented success receipts', async () => {
    const fragmented = defaultDeps()
    fragmented.fetch.mockResolvedValue(streamingResponse(JSON.stringify({
      ok: true, sessionId, continuationToken,
    }), 202, 1))
    expect((await createEveChatProxyHandler(fragmented)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
    expect(fragmented.attachChatSessionStart).toHaveBeenCalledOnce()

    for (const upstream of [
      streamingResponse(JSON.stringify({ok: true, sessionId, continuationToken, extra: true}), 202, 4),
      streamingResponse('{"ok":true', 202, 2),
      streamingByteResponse(Uint8Array.from([0xff]), 202, 1),
      streamingResponse(JSON.stringify({ok: true, sessionId, continuationToken: 'x'.repeat(9_000)}), 202, 128),
    ]) {
      const deps = defaultDeps()
      deps.fetch.mockResolvedValue(upstream)
      expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(502)
      expect(deps.attachChatSessionStart).not.toHaveBeenCalled()
      expect(deps.releaseDefinitiveChatStartRejection).not.toHaveBeenCalled()
    }
  })

  it('fails local capability and upstream setup before acquiring a start or follow-up lease', async () => {
    for (const kind of ['start', 'followUp'] as const) {
      for (const failure of ['mint', 'setup'] as const) {
        const deps = defaultDeps()
        if (kind === 'followUp') deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
        if (failure === 'mint') deps.mintChatCapability.mockImplementation(() => { throw new Error('mint failed') })
        else deps.createTimeoutSignal.mockImplementation(() => { throw new Error('setup failed') })
        const path = kind === 'start' ? startPath : `${startPath}/${sessionId}`

        const response = await createEveChatProxyHandler(deps)(post(path, {message: 'hello'}), {chatId: 'chat-1'})

        expect(response.status).toBe(503)
        expect(deps.reserveChatSessionStart).not.toHaveBeenCalled()
        expect(deps.reserveChatFollowUp).not.toHaveBeenCalled()
        expect(deps.fetch).not.toHaveBeenCalled()
      }
    }
  })

  it('releases exact leases when a prepared request aborts before fetch', async () => {
    const start = defaultDeps()
    start.createTimeoutSignal.mockReturnValue(AbortSignal.abort(new DOMException('setup aborted', 'AbortError')))
    expect((await createEveChatProxyHandler(start)(post(startPath), {chatId: 'chat-1'})).status).toBe(503)
    expect(start.releaseDefinitiveChatStartRejection).toHaveBeenCalledOnce()
    expect(start.fetch).not.toHaveBeenCalled()

    const follow = defaultDeps()
    follow.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    follow.listPendingChatApprovals.mockResolvedValue([approval()])
    follow.createTimeoutSignal.mockReturnValue(AbortSignal.abort(new DOMException('setup aborted', 'AbortError')))
    expect((await createEveChatProxyHandler(follow)(post(`${startPath}/${sessionId}`, {
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
    }), {chatId: 'chat-1'})).status).toBe(503)
    expect(follow.releaseDefinitiveChatFollowUpRejection).toHaveBeenCalledWith(expect.objectContaining({
      claimedResponses: [{requestId: 'request-1', optionId: 'approve'}],
      allowUnclaimedResponses: true,
    }))
    expect(follow.fetch).not.toHaveBeenCalled()
  })

  it('uses the centralized 30 second timeout and retains the ambiguous lease after fetch begins', async () => {
    const deps = defaultDeps()
    const timeout = new AbortController()
    deps.createTimeoutSignal.mockReturnValue(timeout.signal)
    deps.fetch.mockImplementation(async () => {
      timeout.abort(new DOMException('timed out', 'TimeoutError'))
      throw new DOMException('timed out', 'TimeoutError')
    })

    const response = await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})

    expect(response.status).toBe(504)
    expect(deps.createTimeoutSignal).toHaveBeenCalledWith(30_000)
    expect(deps.releaseDefinitiveChatStartRejection).not.toHaveBeenCalled()
  })

  it('retries only captured handle attachment and never returns an untracked handle', async () => {
    const deps = defaultDeps()
    deps.attachChatSessionStart
      .mockResolvedValueOnce(null as never)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(runtimeMapping({eveSessionId: sessionId, sessionOrdinal: 1, sessionState: 'running'}))
    expect((await createEveChatProxyHandler(deps)(post(startPath), {chatId: 'chat-1'})).status).toBe(202)
    expect(deps.sleep.mock.calls.map(call => call[0])).toEqual([50, 150, 300])
    expect(deps.fetch).toHaveBeenCalledOnce()

    const failed = defaultDeps()
    failed.attachChatSessionStart.mockResolvedValue(null as never)
    const response = await createEveChatProxyHandler(failed)(post(startPath), {chatId: 'chat-1'})
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(sessionId)
    expect(failed.fetch).toHaveBeenCalledOnce()
    expect(failed.releaseDefinitiveChatStartRejection).not.toHaveBeenCalled()
  })
})

describe('eve chat proxy approval boundary', () => {
  it('allows ready structured Approve and blocked structured Deny, but rejects blocked Approve and replay', async () => {
    for (const [projectionStatus, optionId, expected] of [
      ['ready', 'approve', 200],
      ['ready', 'deny', 200],
      ['blocked', 'deny', 200],
      ['blocked', 'approve', 409],
    ] as const) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([approval({projectionStatus})])
      deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
      const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
        inputResponses: [{requestId: 'request-1', optionId}],
      }), {chatId: 'chat-1'})
      expect(response.status).toBe(expected)
      expect(deps.fetch).toHaveBeenCalledTimes(expected === 200 ? 1 : 0)
    }

    for (const rows of [
      [approval({requestId: 'other-request'})],
      [],
    ]) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue(rows)
      const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
        inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
      }), {chatId: 'chat-1'})
      expect(response.status).toBe(409)
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })

  it('accepts only strict single-request literal textual approval and leaves non-resolving text ordinary', async () => {
    for (const [message, optionId] of [[' approve ', 'approve'], ['APPROVE', 'approve'], [' Deny ', 'deny']] as const) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([approval()])
      deps.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
      expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {message}), {chatId: 'chat-1'})).status).toBe(200)
      expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({
        inputResponses: [{requestId: 'request-1', optionId}],
        continuationToken,
      })
    }

    for (const message of ['1', '2']) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([approval()])
      expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {message}), {chatId: 'chat-1'})).status).toBe(409)
      expect(deps.fetch).not.toHaveBeenCalled()
    }

    for (const message of ['yes', 'approved', 'no', 'allow', 'tell me more']) {
      const ordinary = defaultDeps()
      ordinary.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      ordinary.listPendingChatApprovals.mockResolvedValue([approval()])
      ordinary.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
      expect((await createEveChatProxyHandler(ordinary)(post(`${startPath}/${sessionId}`, {message}), {chatId: 'chat-1'})).status).toBe(200)
      expect(JSON.parse(String(ordinary.fetch.mock.calls[0]?.[1]?.body))).toEqual({message, continuationToken})
    }

    const ordinary = defaultDeps()
    ordinary.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    ordinary.listPendingChatApprovals.mockResolvedValue([approval()])
    ordinary.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    expect((await createEveChatProxyHandler(ordinary)(post(`${startPath}/${sessionId}`, {message: 'a separate ordinary question'}), {chatId: 'chat-1'})).status).toBe(200)
    expect(JSON.parse(String(ordinary.fetch.mock.calls[0]?.[1]?.body))).toEqual({message: 'a separate ordinary question', continuationToken})
  })

  it('requires structured per-request responses for multiple pending approvals', async () => {
    const rows = [approval(), approval({requestId: 'request-2', callId: 'call-2'})]
    const text = defaultDeps()
    text.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    text.listPendingChatApprovals.mockResolvedValue(rows)
    expect((await createEveChatProxyHandler(text)(post(`${startPath}/${sessionId}`, {message: 'approve'}), {chatId: 'chat-1'})).status).toBe(409)
    expect(text.fetch).not.toHaveBeenCalled()

    const structured = defaultDeps()
    structured.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    structured.listPendingChatApprovals.mockResolvedValue(rows)
    structured.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    expect((await createEveChatProxyHandler(structured)(post(`${startPath}/${sessionId}`, {
      inputResponses: [
        {requestId: 'request-1', optionId: 'approve'},
        {requestId: 'request-2', optionId: 'deny'},
      ],
    }), {chatId: 'chat-1'})).status).toBe(200)
    expect(structured.claimChatApprovalResponses).toHaveBeenCalledOnce()
    expect(structured.claimChatApprovalResponses).toHaveBeenCalledWith(expect.objectContaining({
      responses: [
        {requestId: 'request-1', optionId: 'approve'},
        {requestId: 'request-2', optionId: 'deny'},
      ],
    }))
  })

  it('rejects a structured response combined with text that would resolve approval', async () => {
    const deps = defaultDeps()
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    deps.listPendingChatApprovals.mockResolvedValue([approval()])
    const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
      message: 'approve',
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
    }), {chatId: 'chat-1'})
    expect(response.status).toBe(409)
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it.each(['approve', 'deny'] as const)('atomically restores a claimed %s after definitive Eve rejection', async optionId => {
    const deps = defaultDeps()
    deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    deps.listPendingChatApprovals.mockResolvedValue([approval({projectionStatus: optionId === 'approve' ? 'ready' : 'blocked'})])
    deps.fetch.mockResolvedValue(Response.json({ok: false, error: 'Invalid approval delivery.'}, {status: 400}))
    const claimedResponses = [{requestId: 'request-1', optionId}]

    expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
      inputResponses: claimedResponses,
    }), {chatId: 'chat-1'})).status).toBe(400)
    expect(deps.claimChatApprovalResponses).toHaveBeenCalledOnce()
    expect(deps.releaseDefinitiveChatFollowUpRejection).toHaveBeenCalledWith(expect.objectContaining({
      claimedResponses,
    }))
  })

  it('retains claimed approvals and the lease for ambiguous Eve outcomes', async () => {
    for (const outcome of [
      () => Promise.reject(new TypeError('disconnect')),
      () => Promise.resolve(Response.json({ok: false}, {status: 500})),
      () => Promise.resolve(Response.json({ok: true}, {status: 200})),
    ]) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([approval()])
      deps.fetch.mockImplementation(outcome as never)

      expect((await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
        inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
      }), {chatId: 'chat-1'})).status).toBe(502)
      expect(deps.claimChatApprovalResponses).toHaveBeenCalledOnce()
      expect(deps.releaseDefinitiveChatFollowUpRejection).not.toHaveBeenCalled()
      expect(deps.markChatFollowUpDeliveryAmbiguous).toHaveBeenCalledWith({
        chatId: 'chat-1', eveSessionId: sessionId, sessionOrdinal: 1,
        admissionId: 'follow-up-admission-1', preTurnCursor: 4,
      })
    }
  })

  it('keeps approval retries inside the approval boundary after a definitive rejection', async () => {
    const literal = defaultDeps()
    literal.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    literal.listPendingChatApprovals.mockResolvedValue([approval()])
    literal.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    expect((await createEveChatProxyHandler(literal)(post(`${startPath}/${sessionId}`, {
      message: 'approve',
    }), {chatId: 'chat-1'})).status).toBe(200)
    expect(JSON.parse(String(literal.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}], continuationToken,
    })

    const numeric = defaultDeps()
    numeric.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    numeric.listPendingChatApprovals.mockResolvedValue([approval()])
    expect((await createEveChatProxyHandler(numeric)(post(`${startPath}/${sessionId}`, {
      message: '1',
    }), {chatId: 'chat-1'})).status).toBe(409)
    expect(numeric.fetch).not.toHaveBeenCalled()

    const directRetry = defaultDeps()
    directRetry.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    directRetry.listPendingChatApprovals.mockResolvedValue([approval()])
    directRetry.fetch.mockResolvedValue(Response.json({ok: true, sessionId}))
    expect((await createEveChatProxyHandler(directRetry)(post(`${startPath}/${sessionId}`, {
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
    }), {chatId: 'chat-1'})).status).toBe(200)
    expect(JSON.parse(String(directRetry.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}], continuationToken,
    })

    const resolvedReplay = defaultDeps()
    resolvedReplay.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    resolvedReplay.listPendingChatApprovals.mockResolvedValue([])
    expect((await createEveChatProxyHandler(resolvedReplay)(post(`${startPath}/${sessionId}`, {
      inputResponses: [{requestId: 'request-1', optionId: 'approve'}],
    }), {chatId: 'chat-1'})).status).toBe(409)
    expect(resolvedReplay.fetch).not.toHaveBeenCalled()
  })

  it('releases the lease without partial claims when the complete claim set is rejected or throws', async () => {
    for (const failure of [{status: 'rejected' as const}, new Error('claim failed')]) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.listPendingChatApprovals.mockResolvedValue([
        approval(), approval({requestId: 'request-2', callId: 'call-2'}),
      ])
      if (failure instanceof Error) deps.claimChatApprovalResponses.mockRejectedValue(failure)
      else deps.claimChatApprovalResponses.mockResolvedValue(failure as never)

      const response = await createEveChatProxyHandler(deps)(post(`${startPath}/${sessionId}`, {
        inputResponses: [
          {requestId: 'request-1', optionId: 'approve'},
          {requestId: 'request-2', optionId: 'deny'},
        ],
      }), {chatId: 'chat-1'})

      expect(response.status).toBe(failure instanceof Error ? 503 : 409)
      expect(deps.releaseDefinitiveChatFollowUpRejection).toHaveBeenCalledWith(expect.objectContaining(
        failure instanceof Error
          ? {
              claimedResponses: [
                {requestId: 'request-1', optionId: 'approve'},
                {requestId: 'request-2', optionId: 'deny'},
              ],
              allowUnclaimedResponses: true,
            }
          : {claimedResponses: []},
      ))
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })
})

function streamingPost(bytes: Uint8Array, chunkSize: number, headers: HeadersInit = {}) {
  return new Request(`${chatHost}${startPath}`, {
    method: 'POST',
    headers: {origin: appOrigin, 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers))},
    body: byteStream(bytes, chunkSize),
    duplex: 'half',
  } as RequestInit & {duplex: 'half'})
}

function streamingResponse(body: string, status: number, chunkSize: number, onCancel?: () => void) {
  return streamingByteResponse(new TextEncoder().encode(body), status, chunkSize, onCancel)
}

function streamingByteResponse(bytes: Uint8Array, status: number, chunkSize: number, onCancel?: () => void) {
  return new Response(byteStream(bytes, chunkSize, onCancel), {
    status,
    headers: {'content-type': 'application/json'},
  })
}

function byteStream(bytes: Uint8Array, chunkSize: number, onCancel?: () => void) {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
    cancel() {
      onCancel?.()
    },
  })
}

describe('eve chat proxy stream admission seam', () => {
  it('allows older/equal cursors but rejects ahead cursors with reload guidance', async () => {
    for (const cursor of [0, 4]) {
      const deps = defaultDeps()
      deps.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
      deps.fetch.mockResolvedValue(new Response('', {headers: {'content-type': 'application/x-ndjson'}}))
      const response = await createEveChatProxyHandler(deps)(new Request(`${chatHost}${startPath}/${sessionId}/stream?startIndex=${cursor}`), {chatId: 'chat-1'})
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain(continuationToken)
      expect(deps.fetch).toHaveBeenCalledOnce()
    }

    const ahead = defaultDeps()
    ahead.getAuthorizedChatRuntimeMapping.mockResolvedValue(followUpMapping())
    const response = await createEveChatProxyHandler(ahead)(new Request(`${chatHost}${startPath}/${sessionId}/stream?startIndex=5`), {chatId: 'chat-1'})
    expect(response.status).toBe(409)
    expect(await response.text()).toMatch(/reload|bootstrap/i)
    expect(ahead.fetch).not.toHaveBeenCalled()
  })
})
