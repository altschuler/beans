import {afterEach, describe, expect, it, vi} from 'vitest'
import {createChatReconciler} from '@/eve/chat-reconciliation.server'
import {createEve0221Client} from '@/tests/helpers/eve-0221'

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    chatId: 'chat-1', teamId: 'team-1', userId: 'user-1', eveSessionId: 'session-1',
    eveContinuationToken: 'token-1', sessionOrdinal: 3, eveNextStreamIndex: 4,
    sessionState: 'running' as const, turnStartedAt: new Date(), admissionId: null,
    followUpDeliveryState: 'none' as const, followUpPreTurnCursor: null,
    ...overrides,
  }
}

function dependencies(events: unknown[] = []) {
  const persisted: Array<{streamIndex: number; event: Record<string, unknown>}> = []
  const deps = {
    persisted,
    mintChatCapability: vi.fn(() => `capability-${deps.mintChatCapability.mock.calls.length}`),
    createStream: vi.fn(async ({mintCapability}: {mintCapability: () => string; startIndex: number}) => {
      // The real Client invokes this resolver for every request/reconnect.
      mintCapability()
      mintCapability()
      return iterable(events)
    }),
    sanitizeAndPersist: vi.fn(async ({raw, streamIndex}: {raw: unknown; streamIndex: number}) => {
      const event = raw as Record<string, unknown>
      persisted.push({streamIndex, event})
      return event
    }),
    persistMissingSessionFailure: vi.fn(async () => true),
    hasCommittedBoundary: vi.fn(async () => false),
    restoreUnadmittedFollowUp: vi.fn(async () => true),
    isBoundary: vi.fn((event: Record<string, unknown>) => ['session.waiting', 'session.completed', 'session.failed'].includes(String(event.type))),
    setTimeout,
    clearTimeout,
    env: {PENGE_EVE_BASE_URL: 'http://eve.test/'} as Partial<Record<'PENGE_EVE_BASE_URL', string>>,
  }
  return deps
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Eve chat reconciliation', () => {
  it('uses the version-pinned real ClientSession stream with redirect protection and auth renewal on reconnect', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(disconnectingNdjsonResponse({type: 'session.started', data: {}}))
      .mockResolvedValueOnce(ndjsonResponse({type: 'session.completed'}))
    vi.stubGlobal('fetch', fetchMock)
    let capabilityIndex = 0
    const client = await createEve0221Client({
      host: 'http://eve.test',
      auth: {bearer: () => `capability-${++capabilityIndex}`},
      redirect: 'error',
      maxReconnectAttempts: 1,
      preserveCompletedSessions: true,
    })
    const events = []

    for await (const event of client.session({
      sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 4,
    }).stream({startIndex: 4})) events.push(event)

    expect(events.map(event => event.type)).toEqual(['session.started', 'session.completed'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'http://eve.test/eve/v1/session/session-1/stream?startIndex=4',
      'http://eve.test/eve/v1/session/session-1/stream?startIndex=5',
    ])
    expect(fetchMock.mock.calls.map(call => (call[1]?.headers as Headers).get('authorization'))).toEqual([
      'Bearer capability-1', 'Bearer capability-2',
    ])
    expect(fetchMock.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
  })

  it('surfaces a durable 404 through the version-pinned real ClientSession stream', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('missing', {status: 404}))
    vi.stubGlobal('fetch', fetchMock)
    let capabilities = 0
    const client = await createEve0221Client({
      host: 'http://eve.test', auth: {bearer: () => `capability-${++capabilities}`},
      redirect: 'error', maxReconnectAttempts: 0,
    })
    const next = client.session({
      sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 4,
    }).stream({startIndex: 4})[Symbol.asyncIterator]().next()

    const rejected = expect(next).rejects.toMatchObject({status: 404})
    await vi.advanceTimersByTimeAsync(3_000)

    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(capabilities).toBe(12)
    expect(fetchMock.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
  })

  it('opens the exact stored session at the committed cursor with redirect protection and fresh capabilities', async () => {
    const deps = dependencies([{type: 'session.completed'}])
    const reconcile = createChatReconciler(deps)
    const promise = reconcile(mapping())
    await promise

    expect(deps.createStream).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'http://eve.test',
      state: {sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 4},
      startIndex: 4,
      redirect: 'error',
      signal: expect.any(AbortSignal),
      mintCapability: expect.any(Function),
    }))
    expect(deps.mintChatCapability).toHaveBeenCalledTimes(2)
    expect(deps.mintChatCapability).toHaveBeenCalledWith({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
    expect(deps.persisted).toEqual([{streamIndex: 4, event: {type: 'session.completed'}}])
  })

  it('persists gaps in order, detects a real boundary, then waits for quiescence', async () => {
    vi.useFakeTimers()
    const events = pushableIterable()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(events.iterable)
    const promise = createChatReconciler(deps)(mapping({eveNextStreamIndex: 2}))

    events.push({type: 'message.appended'})
    await vi.advanceTimersByTimeAsync(1)
    events.push({type: 'session.waiting', data: {wait: 'next-user-message'}})
    await vi.advanceTimersByTimeAsync(249)
    expect(await promiseState(promise)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toMatchObject({status: 'boundary', boundary: 'session.waiting', nextStreamIndex: 4})
    expect(deps.persisted.map(row => row.streamIndex)).toEqual([2, 3])
  })

  it('reopens clean EOF from the committed cursor until a real boundary or the 15 second deadline', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(iterable([]))
    const promise = createChatReconciler(deps)(mapping())

    await vi.advanceTimersByTimeAsync(14_999)
    expect(await promiseState(promise)).toBe('pending')
    expect(deps.createStream.mock.calls.length).toBeGreaterThan(1)
    expect(deps.createStream.mock.calls.every(call => call[0].startIndex === 4)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toEqual({status: 'timeout', nextStreamIndex: 4})
    expect(deps.sanitizeAndPersist).not.toHaveBeenCalled()
  })

  it('does not reuse an earlier clean EOF after the latest stream attempt hangs through the deadline', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream
      .mockResolvedValueOnce(iterable([]))
      .mockResolvedValueOnce(neverIterable())
    const promise = createChatReconciler(deps)(mapping({
      admissionId: 'admission-1',
      followUpDeliveryState: 'ambiguous',
      followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))

    await vi.advanceTimersByTimeAsync(15_000)

    await expect(promise).resolves.toEqual({status: 'timeout', nextStreamIndex: 4})
    expect(deps.createStream).toHaveBeenCalledTimes(2)
    expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
  })

  it('restores after repeated clean EOF attempts when the latest clean EOF reaches the full deadline', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(iterable([]))
    const promise = createChatReconciler(deps)(mapping({
      admissionId: 'admission-1',
      followUpDeliveryState: 'ambiguous',
      followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))

    await vi.advanceTimersByTimeAsync(14_999)
    expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toEqual({status: 'restored', nextStreamIndex: 4})
    expect(deps.createStream.mock.calls.length).toBeGreaterThan(1)
    expect(deps.restoreUnadmittedFollowUp).toHaveBeenCalledWith({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 3,
      admissionId: 'admission-1', preTurnCursor: 4,
    })
  })

  it('never restores when an admitted follow-up advances the stream, even without a boundary', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockImplementation(async ({startIndex}: {startIndex: number}) =>
      iterable(startIndex === 4 ? [{type: 'turn.started', data: {}}] : []))
    const promise = createChatReconciler(deps)(mapping({
      admissionId: 'admission-1', followUpDeliveryState: 'ambiguous', followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))

    await vi.advanceTimersByTimeAsync(15_000)

    await expect(promise).resolves.toEqual({status: 'timeout', nextStreamIndex: 5})
    expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
  })

  it('never restores a pending dispatch directly even after a clean zero-advance deadline', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(iterable([]))
    const promise = createChatReconciler(deps)(mapping({
      admissionId: 'admission-1', followUpDeliveryState: 'pending', followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))

    await vi.advanceTimersByTimeAsync(15_000)

    await expect(promise).resolves.toEqual({status: 'timeout', nextStreamIndex: 4})
    expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
  })

  it('never restores an acknowledged slow follow-up merely because its stream is still quiet', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(iterable([]))
    const promise = createChatReconciler(deps)(mapping({
      admissionId: 'admission-1', followUpDeliveryState: 'acknowledged', followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))

    await vi.advanceTimersByTimeAsync(15_000)

    await expect(promise).resolves.toEqual({status: 'timeout', nextStreamIndex: 4})
    expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
  })

  it('does not restore after a transient creation error, malformed latest iterator, or missing-session response', async () => {
    for (const error of [new Error('transient'), Object.assign(new Error('missing'), {status: 404})]) {
      const deps = dependencies()
      deps.createStream.mockRejectedValue(error)
      await createChatReconciler(deps)(mapping({
        admissionId: 'admission-1', followUpDeliveryState: 'ambiguous', followUpPreTurnCursor: 4,
        recoverUndeliveredFollowUp: true,
      }))
      expect(deps.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
    }

    const malformed = dependencies()
    malformed.createStream
      .mockResolvedValueOnce(iterable([]))
      .mockResolvedValueOnce(rejectingIterable(new SyntaxError('malformed NDJSON')))
    await expect(createChatReconciler(malformed)(mapping({
      admissionId: 'admission-1', followUpDeliveryState: 'ambiguous', followUpPreTurnCursor: 4,
      recoverUndeliveredFollowUp: true,
    }))).resolves.toEqual({status: 'interrupted', nextStreamIndex: 4})
    expect(malformed.restoreUnadmittedFollowUp).not.toHaveBeenCalled()
  })

  it.each(['completed', 'failed'] as const)('short-circuits a committed terminal %s boundary without contacting Eve', async sessionState => {
    const deps = dependencies()
    deps.hasCommittedBoundary.mockResolvedValue(true)
    deps.env = {}
    deps.createStream.mockRejectedValue(Object.assign(new Error('missing'), {status: 404}))

    await expect(createChatReconciler(deps)(mapping({sessionState}))).resolves.toEqual({
      status: 'boundary', boundary: `session.${sessionState}`, nextStreamIndex: 4,
    })
    expect(deps.createStream).not.toHaveBeenCalled()
    expect(deps.mintChatCapability).not.toHaveBeenCalled()
    expect(deps.persistMissingSessionFailure).not.toHaveBeenCalled()
  })

  it('short-circuits a committed waiting boundary without opening another idle Eve stream', async () => {
    const deps = dependencies()
    deps.hasCommittedBoundary.mockResolvedValue(true)

    await expect(createChatReconciler(deps)(mapping({sessionState: 'waiting'}))).resolves.toEqual({
      status: 'boundary', boundary: 'session.waiting', nextStreamIndex: 4,
    })
    expect(deps.createStream).not.toHaveBeenCalled()
    expect(deps.mintChatCapability).not.toHaveBeenCalled()
    expect(deps.sanitizeAndPersist).not.toHaveBeenCalled()
  })

  it('bounds a stream with no boundary at 15 seconds and does not persist a local reset state', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.createStream.mockResolvedValue(neverIterable())
    const promise = createChatReconciler(deps)(mapping())

    await vi.advanceTimersByTimeAsync(14_999)
    expect(await promiseState(promise)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toMatchObject({status: 'timeout', nextStreamIndex: 4})
    expect(deps.sanitizeAndPersist).not.toHaveBeenCalled()
    expect(deps.persistMissingSessionFailure).not.toHaveBeenCalled()
  })

  it('is idempotent when replayed rows return committed canonical values', async () => {
    const committed = new Map([[4, {type: 'message.appended', data: {canonical: true}}], [5, {type: 'session.completed'}]])
    const deps = dependencies([{raw: 'duplicate'}, {type: 'session.completed'}])
    deps.sanitizeAndPersist.mockImplementation(async ({streamIndex}: {streamIndex: number}) => committed.get(streamIndex)!)

    await createChatReconciler(deps)(mapping())
    await createChatReconciler(deps)(mapping())

    expect(deps.sanitizeAndPersist.mock.calls.map(call => call[0].streamIndex)).toEqual([4, 5, 4, 5])
    expect(committed.size).toBe(2)
  })

  it('marks only the exact current mapping failed with one positional fixed event when Eve reports a missing session', async () => {
    const deps = dependencies()
    deps.createStream.mockRejectedValue(Object.assign(new Error('raw Eve details'), {status: 404}))

    await expect(createChatReconciler(deps)(mapping())).resolves.toEqual({status: 'missing', nextStreamIndex: 5})
    expect(deps.persistMissingSessionFailure).toHaveBeenCalledWith({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 3, streamIndex: 4,
    })
    expect(JSON.stringify(deps.persistMissingSessionFailure.mock.calls)).not.toContain('raw Eve details')
  })

  it('never treats persistence failures as proof that the Eve session is missing', async () => {
    const deps = dependencies([{type: 'session.completed'}])
    deps.sanitizeAndPersist.mockRejectedValue(Object.assign(new Error('database error'), {status: 404}))

    await expect(createChatReconciler(deps)(mapping())).resolves.toEqual({status: 'interrupted', nextStreamIndex: 4})
    expect(deps.persistMissingSessionFailure).not.toHaveBeenCalled()
  })

  it('treats stale mapping persistence as a no-op and never holds a repository transaction during network waiting', async () => {
    let networkStarted = false
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const deps = dependencies([{type: 'session.completed'}])
    deps.createStream.mockImplementation(async () => {
      networkStarted = true
      await blocked
      return iterable([{type: 'session.completed'}])
    })
    deps.sanitizeAndPersist.mockRejectedValue(new Error('Chat runtime session changed during stream persistence'))

    const promise = createChatReconciler(deps)(mapping())
    await vi.waitFor(() => expect(networkStarted).toBe(true))
    // A network call is outstanding while no database callback/transaction is active.
    expect(deps.sanitizeAndPersist).not.toHaveBeenCalled()
    release()
    await expect(promise).resolves.toMatchObject({status: 'stale'})
    expect(deps.persistMissingSessionFailure).not.toHaveBeenCalled()
  })
})

function ndjsonResponse(event: unknown) {
  return new Response(`${JSON.stringify(event)}\n`, {headers: {'content-type': 'application/x-ndjson'}})
}

function disconnectingNdjsonResponse(event: unknown) {
  const encoder = new TextEncoder()
  let pulled = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!pulled) {
        pulled = true
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        return
      }
      controller.error(new Error('socket disconnected'))
    },
  }), {headers: {'content-type': 'application/x-ndjson'}})
}

function iterable(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events
    },
  }
}

function rejectingIterable(error: Error): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(error),
        return: async () => ({done: true, value: undefined}),
      }
    },
  }
}

function neverIterable(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: async () => ({done: true, value: undefined}),
      }
    },
  }
}

function pushableIterable() {
  const values: unknown[] = []
  const resolvers: Array<(value: IteratorResult<unknown>) => void> = []
  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: () => values.length > 0
            ? Promise.resolve({done: false as const, value: values.shift()})
            : new Promise<IteratorResult<unknown>>(resolve => resolvers.push(resolve)),
          return: async () => ({done: true as const, value: undefined}),
        }
      },
    },
    push(value: unknown) {
      const resolve = resolvers.shift()
      if (resolve) resolve({done: false, value})
      else values.push(value)
    },
  }
}

async function promiseState(promise: Promise<unknown>) {
  return Promise.race([promise.then(() => 'settled'), Promise.resolve('pending')])
}
