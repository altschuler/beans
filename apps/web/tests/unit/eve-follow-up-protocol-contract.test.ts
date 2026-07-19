import {afterEach, describe, expect, it, vi} from 'vitest'
import {Client} from 'eve/client'
import {eveChannel} from 'eve/channels/eve'

const sessionId = 'eve-session-1'
const continuationToken = 'continuation-1'

afterEach(() => vi.unstubAllGlobals())

describe('Eve native follow-up receipt contract', () => {
  it('does not acknowledge the public follow-up route until Eve advances the durable stream', async () => {
    const durableEvents: unknown[] = [
      {type: 'session.started', data: {}},
      {type: 'session.waiting', data: {continuationToken, wait: 'next-user-message'}},
    ]
    const preTurnCursor = durableEvents.length
    const ordering: string[] = []
    const channel = eveChannel({
      auth: async () => ({
        attributes: {}, authenticator: 'test', principalId: 'user-1', principalType: 'user', subject: 'user-1',
      }),
    }) as unknown as {
      routes: Array<{
        method: string
        path: string
        handler(request: Request, context: Record<string, unknown>): Promise<Response>
      }>
    }
    const followUpRoute = channel.routes.find(route =>
      route.method === 'POST' && route.path === '/eve/v1/session/:sessionId')
    const streamRoute = channel.routes.find(route =>
      route.method === 'GET' && route.path === '/eve/v1/session/:sessionId/stream')
    if (!followUpRoute || !streamRoute) throw new Error('Eve session routes are missing')

    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request))
      const incoming = new Request(url, init)
      const getSession = () => ({
        getEventStream: ({startIndex = 0}: {startIndex?: number} = {}) => eventStream(durableEvents.slice(startIndex)),
      })
      if (incoming.method === 'POST') {
        ordering.push('post-received')
        const response = await followUpRoute.handler(incoming, {
          params: {sessionId},
          getSession,
          send: async () => {
            // Eve's accepted delivery resumes the durable turn preamble. Its first public event is
            // turn.started, before provider/model work and before this route can return its receipt.
            durableEvents.push({type: 'turn.started', data: {sequence: 2, turnId: 'turn_2'}})
            ordering.push('durable-stream-advanced')
            return {id: sessionId, continuationToken}
          },
        })
        ordering.push('receipt-returned')
        return response
      }
      return streamRoute.handler(incoming, {params: {sessionId}, getSession})
    }))

    const client = new Client({host: 'https://eve.test', maxReconnectAttempts: 0})
    const session = client.session({sessionId, continuationToken, streamIndex: preTurnCursor})
    await session.send({message: 'follow up'})

    expect(ordering).toEqual(['post-received', 'durable-stream-advanced', 'receipt-returned'])
    expect(durableEvents).toHaveLength(preTurnCursor + 1)
    const iterator = session.stream({startIndex: preTurnCursor})[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {type: 'turn.started', data: {sequence: 2, turnId: 'turn_2'}},
    })
    await iterator.return?.()
  })
})

function eventStream(events: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const event of events) controller.enqueue(event)
      controller.close()
    },
  }).pipeThrough(new TransformStream<unknown, unknown>({transform: (event, controller) => controller.enqueue(event)})) as never
}
