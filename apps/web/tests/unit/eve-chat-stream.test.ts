import {afterEach, describe, expect, it, vi} from 'vitest'
import {createEveChatProxyHandler} from '@/eve/eve-chat-proxy.server'
import {createNdjsonSanitizingTransform} from '@/eve/ndjson-transform.server'

const appOrigin = 'https://app.test'
const host = `${appOrigin}/api/eve/chat/chat-1`
const sessionId = 'session-1'

function mapping(cursor = 0) {
  return {
    chatId: 'chat-1', teamId: 'team-1', userId: 'user-1', eveSessionId: sessionId,
    eveContinuationToken: 'token-1', sessionOrdinal: 2, eveNextStreamIndex: cursor,
    sessionState: 'running' as const, turnStartedAt: new Date(), admissionId: null,
    followUpDeliveryState: 'none' as const, followUpPreTurnCursor: null,
  }
}

function streamRequest(startIndex: string) {
  return new Request(`${host}/eve/v1/session/${sessionId}/stream?startIndex=${startIndex}`)
}

function deps(cursor = 0) {
  const committed = new Map<number, Record<string, unknown>>()
  return {
    committed,
    getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
    getAuthorizedChatRuntimeMapping: vi.fn(async () => mapping(cursor)),
    reserveChatSessionStart: vi.fn(), reserveChatFollowUp: vi.fn(), attachChatSessionStart: vi.fn(),
    releaseDefinitiveChatStartRejection: vi.fn(), releaseDefinitiveChatFollowUpRejection: vi.fn(),
    markChatFollowUpDeliveryAcknowledged: vi.fn(), markChatFollowUpDeliveryAmbiguous: vi.fn(),
    reapStaleChatAdmissions: vi.fn(async () => []), listPendingChatApprovals: vi.fn(async () => []),
    claimChatApprovalResponses: vi.fn(),
    currentChatSessionHasCommittedTerminalBoundary: vi.fn(async () => true),
    mintChatCapability: vi.fn(() => 'fresh-capability'),
    reconcileChatRuntime: vi.fn(async () => ({status: 'boundary' as const, boundary: 'session.completed', nextStreamIndex: cursor})),
    fetch: vi.fn<typeof fetch>(async () => ndjsonResponse([
      {type: 'message.received', data: {message: 'raw secret'}},
      {type: 'session.waiting', data: {wait: 'next-user-message'}},
    ])),
    createTimeoutSignal: vi.fn(() => new AbortController().signal), sleep: vi.fn(), warn: vi.fn(),
    createChatEventTransform: vi.fn((input: {startIndex: number}) => createNdjsonSanitizingTransform({
      startIndex: input.startIndex,
      sanitize: async (_raw, streamIndex) => ({
        event: {type: 'safe.event', data: {streamIndex}},
        approvalProjections: [],
      }),
      persist: async ({streamIndex, sanitized}) => {
        const canonical = committed.get(streamIndex) ?? sanitized.event
        committed.set(streamIndex, canonical)
        return {event: canonical}
      },
    })),
    env: {PENGE_EVE_BASE_URL: 'http://eve.test/', VITE_PUBLIC_APP_URL: appOrigin},
  }
}

afterEach(() => vi.useRealTimers())

describe('Eve chat stream proxy', () => {
  it('accepts only canonical nonnegative cursors, accepts replay, and rejects an ahead cursor', async () => {
    for (const invalid of ['00', '-1', '1.0', '+1', '9007199254740992']) {
      const input = deps(4)
      expect((await createEveChatProxyHandler(input)(streamRequest(invalid), {chatId: 'chat-1'})).status).toBe(404)
      expect(input.fetch).not.toHaveBeenCalled()
    }

    for (const startIndex of [0, 4]) {
      const input = deps(4)
      expect((await createEveChatProxyHandler(input)(streamRequest(String(startIndex)), {chatId: 'chat-1'})).status).toBe(200)
    }

    const ahead = deps(4)
    const response = await createEveChatProxyHandler(ahead)(streamRequest('5'), {chatId: 'chat-1'})
    expect(response.status).toBe(409)
    expect(await response.text()).toMatch(/reload|bootstrap/i)
    expect(ahead.fetch).not.toHaveBeenCalled()
  })

  it('fetches the exact Eve stream without cookies or redirects and returns exact streaming headers', async () => {
    const input = deps()
    const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})

    expect(response.status).toBe(200)
    expect(input.mintChatCapability).toHaveBeenCalledOnce()
    expect(input.fetch).toHaveBeenCalledWith('http://eve.test/eve/v1/session/session-1/stream?startIndex=0', expect.objectContaining({
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: {accept: 'application/x-ndjson', authorization: 'Bearer fresh-capability'},
      signal: expect.any(AbortSignal),
    }))
    expect(Object.fromEntries(response.headers)).toEqual({
      'cache-control': 'no-store, no-transform',
      'content-type': 'application/x-ndjson',
    })
    expect(input.createTimeoutSignal).not.toHaveBeenCalled()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()
  })

  it('keeps an established browser stream alive beyond the POST timeout without leaving timeout work behind', async () => {
    vi.useFakeTimers()
    const input = deps()
    input.fetch.mockResolvedValue(new Response(delayedNdjson(30_001), {
      headers: {'content-type': 'application/x-ndjson'},
    }))

    const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})
    const body = response.text()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await promiseState(body)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    await expect(body).resolves.toContain('safe.event')
    expect(input.createTimeoutSignal).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles fragmented multiple lines and a trailing line while emitting exactly committed canonical rows', async () => {
    const input = deps()
    const raw = `${JSON.stringify({raw: 'first'})}\r\n${JSON.stringify({raw: 'second'})}\n${JSON.stringify({raw: 'third'})}`
    input.fetch.mockResolvedValue(new Response(fragmented(raw, 1), {headers: {'content-type': 'application/x-ndjson; charset=utf-8'}}))

    const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})
    const browser = await response.text()
    const rows = [...input.committed.values()]
    expect(browser).toBe(rows.map(row => `${JSON.stringify(row)}\n`).join(''))
    expect(rows).toHaveLength(3)
    expect(browser).not.toContain('"raw":"first"')
  })

  it('replays old positions idempotently from committed canonical rows', async () => {
    const input = deps(1)
    input.committed.set(0, {type: 'safe.event', data: {canonical: 'original'}})
    input.fetch.mockResolvedValue(ndjsonResponse([{raw: 'different replay'}]))

    const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})
    expect(await response.text()).toBe(`${JSON.stringify(input.committed.get(0))}\n`)
  })

  it('disconnects on persistence failure without emitting raw or synthetic fallback', async () => {
    const input = deps()
    input.fetch.mockResolvedValue(ndjsonResponse([{raw: 'do-not-leak'}]))
    input.createChatEventTransform.mockImplementation(({startIndex}: {startIndex: number}) => createNdjsonSanitizingTransform({
      startIndex,
      sanitize: async () => ({event: {type: 'safe.event'}, approvalProjections: []}),
      persist: async () => { throw new Error('database unavailable') },
    }))

    const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})
    await expect(response.text()).rejects.toThrow()
    expect(input.committed.size).toBe(0)
  })

  it('returns bounded safe errors for missing bodies, bad status, or non-NDJSON without reading raw bodies', async () => {
    const cases = [
      new Response(null, {status: 200, headers: {'content-type': 'application/x-ndjson'}}),
      new Response('provider secret', {status: 500, headers: {'content-type': 'application/x-ndjson'}}),
      new Response('provider secret', {status: 200, headers: {'content-type': 'text/plain'}}),
      new Response('{"raw":"provider secret"', {status: 200, headers: {'content-type': 'application/x-ndjson'}}),
    ]
    for (const upstream of cases) {
      const input = deps()
      input.fetch.mockResolvedValue(upstream)
      const response = await createEveChatProxyHandler(input)(streamRequest('0'), {chatId: 'chat-1'})
      expect(response.status).toBe(502)
      const body = await response.text()
      expect(body.length).toBeLessThan(256)
      expect(body).not.toContain('provider secret')
      expect(input.committed.size).toBe(0)
    }
  })
})

function ndjsonResponse(events: unknown[]) {
  return new Response(events.map(event => `${JSON.stringify(event)}\n`).join(''), {
    headers: {'content-type': 'application/x-ndjson', 'content-length': '999', 'content-encoding': 'gzip', connection: 'keep-alive'},
  })
}

function delayedNdjson(delayMs: number) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({type: 'session.started', data: {}})}\n`))
      setTimeout(() => {
        controller.enqueue(encoder.encode(`${JSON.stringify({type: 'session.waiting', data: {wait: 'next-user-message'}})}\n`))
        controller.close()
      }, delayMs)
    },
  })
}

async function promiseState(promise: Promise<unknown>) {
  return Promise.race([promise.then(() => 'settled'), Promise.resolve('pending')])
}

function fragmented(value: string, size: number) {
  const bytes = new TextEncoder().encode(value)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close()
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  })
}
