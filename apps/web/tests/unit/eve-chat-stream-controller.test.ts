import {describe, expect, it, vi} from 'vitest'
import type {ClientSession, HandleMessageStreamEvent} from 'eve/client'
import {EveChatStreamController} from '@/components/assistant/eve-chat-stream-controller'

const waiting = {type: 'session.waiting', data: {wait: 'next-user-message'}} as HandleMessageStreamEvent

describe('Eve chat stream controller', () => {
  it('owns one attachment, preserves positional indexes, and settles on a boundary', async () => {
    let streamCalls = 0
    const session = fakeSession(async function* () {
      streamCalls += 1
      yield {type: 'session.started', data: {}} as HandleMessageStreamEvent
      yield waiting
    })
    const events: Array<[string, number]> = []
    const stops = vi.fn()
    const controller = new EveChatStreamController()

    const first = controller.attach({session, startIndex: 4, onEvent: (event, index) => events.push([event.type, index]), onStop: stops})
    const overlapping = controller.attach({session, startIndex: 99, onEvent: vi.fn(), onStop: vi.fn()})

    expect(overlapping).toBe(first)
    await expect(first).resolves.toEqual({kind: 'boundary'})
    await vi.waitFor(() => expect(stops).toHaveBeenCalledWith({kind: 'boundary'}))
    expect(streamCalls).toBe(1)
    expect(events).toEqual([['session.started', 4], ['session.waiting', 5]])
  })

  it('catches stream errors and EOF without creating an unhandled promise', async () => {
    const error = new Error('disconnect')
    const errorStops = vi.fn()
    const errorController = new EveChatStreamController()
    const errorRun = errorController.attach({
      session: fakeSession(async function* ({signal} = {}) { if (!signal) yield waiting; throw error }),
      startIndex: 0,
      onEvent: vi.fn(),
      onStop: errorStops,
    })
    await expect(errorRun).resolves.toEqual({kind: 'error', error})
    await vi.waitFor(() => expect(errorStops).toHaveBeenCalledWith({kind: 'error', error}))

    const eofStops = vi.fn()
    const eofRun = new EveChatStreamController().attach({
      session: fakeSession(async function* ({signal} = {}) { if (!signal) yield waiting }),
      startIndex: 0,
      onEvent: vi.fn(),
      onStop: eofStops,
    })
    await expect(eofRun).resolves.toEqual({kind: 'eof'})
    await vi.waitFor(() => expect(eofStops).toHaveBeenCalledWith({kind: 'eof'}))
  })

  it('aborts the owned stream during cleanup', async () => {
    let observedAbort = false
    const session = {
      stream({signal}: {signal?: AbortSignal} = {}) {
        return {
          async *[Symbol.asyncIterator]() {
            if (!signal) yield waiting
            await new Promise<void>(resolve => {
              if (signal?.aborted) return resolve()
              signal?.addEventListener('abort', () => { observedAbort = true; resolve() }, {once: true})
            })
          },
        }
      },
    } as unknown as ClientSession
    const controller = new EveChatStreamController()
    const run = controller.attach({session, startIndex: 0, onEvent: vi.fn(), onStop: vi.fn()})
    controller.stop()

    await expect(run).resolves.toEqual({kind: 'aborted'})
    expect(observedAbort).toBe(true)
  })
})

function fakeSession(stream: (options?: {startIndex?: number; signal?: AbortSignal}) => AsyncGenerator<HandleMessageStreamEvent>) {
  return {stream} as unknown as ClientSession
}
