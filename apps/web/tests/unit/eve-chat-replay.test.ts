import {afterEach, describe, expect, it, vi} from 'vitest'
import type {HandleMessageStreamEvent} from 'eve/client'
import {replayEveChatSession} from '@/components/assistant/eve-chat-replay'

const event = (type: HandleMessageStreamEvent['type'], data?: unknown) => ({
  type,
  ...(data === undefined ? {} : {data}),
}) as HandleMessageStreamEvent

const waiting = event('session.waiting', {wait: 'next-user-message'})

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true})
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('replayEveChatSession', () => {
  it('opens a fresh chat without creating a replay stream', async () => {
    await expect(replayEveChatSession(null, () => {
      throw new Error('stream should not be created')
    })).resolves.toEqual({events: [], initialSession: undefined, readOnly: false})
  })

  it('preserves historical waiting boundaries and stops at the latest parked boundary', async () => {
    vi.useFakeTimers()
    let finalized = false
    const replayEvents = [
      event('session.started', {}),
      waiting,
      event('turn.started', {sequence: 2, turnId: 'turn-2'}),
      event('message.appended', {messageDelta: 'Second', messageSoFar: 'Second', sequence: 2, stepIndex: 0, turnId: 'turn-2'}),
      waiting,
    ]

    const replayPromise = replayEveChatSession('session-1', (_sessionId, signal) => (async function* () {
      try {
        yield* replayEvents
        await waitForAbort(signal)
      } finally {
        finalized = true
      }
    })())

    await vi.advanceTimersByTimeAsync(299)
    expect(finalized).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(replayPromise).resolves.toEqual({
      events: replayEvents,
      initialSession: {sessionId: 'session-1', streamIndex: replayEvents.length},
      readOnly: false,
    })
    expect(finalized).toBe(true)
  })

  it('waits for the quiet window before accepting a parked waiting boundary and cancels the reader', async () => {
    vi.useFakeTimers()
    let finalized = false
    let replaySignal: AbortSignal | undefined
    const replayPromise = replayEveChatSession('session-1', (_sessionId, signal) => (async function* () {
      replaySignal = signal
      try {
        yield waiting
        await waitForAbort(signal)
      } finally {
        finalized = true
      }
    })())

    await vi.advanceTimersByTimeAsync(299)
    expect(finalized).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(replayPromise).resolves.toMatchObject({
      events: [waiting],
      initialSession: {streamIndex: 1},
      readOnly: false,
    })
    expect(replaySignal?.aborted).toBe(true)
    expect(finalized).toBe(true)
  })

  it('does not time out while an in-flight turn is producing ordinary events', async () => {
    vi.useFakeTimers()
    const answer = event('message.appended', {messageDelta: 'Done', messageSoFar: 'Done', sequence: 2, stepIndex: 0, turnId: 'turn-2'})
    const replayPromise = replayEveChatSession('session-1', (_sessionId, signal) => (async function* () {
      yield waiting
      yield event('turn.started', {sequence: 2, turnId: 'turn-2'})
      await new Promise(resolve => setTimeout(resolve, 1_000))
      yield answer
      yield event('session.completed')
      await waitForAbort(signal)
    })())

    await vi.advanceTimersByTimeAsync(999)
    let settled = false
    void replayPromise.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const result = await replayPromise
    expect(result.events).toContain(answer)
    expect(result.events.at(-1)?.type).toBe('session.completed')
    expect(result.readOnly).toBe(true)
  })

  it.each(['session.completed', 'session.failed'] as const)('stops immediately at terminal %s', async type => {
    let reads = 0
    const terminal = event(type)
    const result = await replayEveChatSession('session-1', () => (async function* () {
      reads += 1
      yield terminal
      reads += 1
      throw new Error('read past terminal boundary')
    })())

    expect(result.events).toEqual([terminal])
    expect(result.readOnly).toBe(true)
    expect(reads).toBe(1)
  })

  it('propagates parent cancellation and finalizes the stream', async () => {
    let finalized = false
    const parent = new AbortController()
    const reason = new Error('loader unmounted')
    const replayPromise = replayEveChatSession('session-1', (_sessionId, signal) => (async function* () {
      try {
        yield event('session.started', {})
        await waitForAbort(signal)
      } finally {
        finalized = true
      }
    })(), parent.signal)

    await Promise.resolve()
    parent.abort(reason)

    await expect(replayPromise).rejects.toBe(reason)
    expect(finalized).toBe(true)
  })

  it('propagates stream errors', async () => {
    const failure = new Error('stream failed')
    await expect(replayEveChatSession('session-1', () => (async function* () {
      yield event('session.started', {})
      throw failure
    })())).rejects.toBe(failure)
  })

  it('rejects unexpected EOF without a replay boundary', async () => {
    await expect(replayEveChatSession('session-1', () => (async function* () {
      yield event('session.started', {})
    })())).rejects.toThrow('Eve chat replay ended without a session boundary.')
  })
})
