import type {HandleMessageStreamEvent, SessionState} from 'eve/client'

export type EveChatReplay = {
  events: HandleMessageStreamEvent[]
  initialSession: SessionState | undefined
  readOnly: boolean
}

type ReplayStreamFactory = (
  sessionId: string,
  signal: AbortSignal,
) => AsyncIterable<HandleMessageStreamEvent>

const parkedSessionQuietWindowMs = 300
const parkedSessionTimeout = Symbol('parked-session-timeout')

/**
 * Eve's local-world reader polls for appended chunks every 100ms and keeps a live session stream
 * open while the workflow is parked between turns; EOF is written only when the run terminates.
 * Historical `session.waiting` events remain in the append-only stream, so replay probes one event
 * beyond each waiting boundary. Three quiet polls identify the current parked boundary; once an
 * in-flight turn event arrives, replay waits without a timeout until its next durable boundary.
 */
export async function replayEveChatSession(
  eveSessionId: string | null,
  stream: ReplayStreamFactory,
  parentSignal?: AbortSignal,
): Promise<EveChatReplay> {
  if (!eveSessionId) return {events: [], initialSession: undefined, readOnly: false}
  if (parentSignal?.aborted) throw parentSignal.reason

  const replayController = new AbortController()
  const abortFromParent = () => replayController.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', abortFromParent, {once: true})

  const iterator = stream(eveSessionId, replayController.signal)[Symbol.asyncIterator]()
  const events: HandleMessageStreamEvent[] = []
  let boundary: HandleMessageStreamEvent | undefined
  let nextResult: IteratorResult<HandleMessageStreamEvent> | undefined

  try {
    for (;;) {
      const result = nextResult ?? await iterator.next()
      nextResult = undefined
      if (result.done) throw new Error('Eve chat replay ended without a session boundary.')

      const event = result.value
      events.push(event)
      if (event.type === 'session.completed' || event.type === 'session.failed') {
        boundary = event
        break
      }
      if (event.type !== 'session.waiting') continue

      const pendingNext = iterator.next()
      const lookahead = await readWithQuietWindow(pendingNext)
      if (lookahead === parkedSessionTimeout) {
        boundary = event
        replayController.abort(new DOMException('Parked Eve session replay completed.', 'AbortError'))
        await pendingNext.catch(() => undefined)
        break
      }
      if (lookahead.done) {
        boundary = event
        break
      }
      nextResult = lookahead
    }
  } finally {
    parentSignal?.removeEventListener('abort', abortFromParent)
    if (!replayController.signal.aborted) replayController.abort()
    await iterator.return?.()
  }

  return {
    events,
    initialSession: {sessionId: eveSessionId, streamIndex: events.length},
    readOnly: boundary?.type === 'session.completed' || boundary?.type === 'session.failed',
  }
}

async function readWithQuietWindow(pendingNext: Promise<IteratorResult<HandleMessageStreamEvent>>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pendingNext,
      new Promise<typeof parkedSessionTimeout>(resolve => {
        timer = setTimeout(() => resolve(parkedSessionTimeout), parkedSessionQuietWindowMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
