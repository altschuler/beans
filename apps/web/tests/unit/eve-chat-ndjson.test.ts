import {describe, expect, it, vi} from 'vitest'
import {createNdjsonSanitizingTransform} from '@/eve/ndjson-transform.server'
import {CHAT_MAX_NDJSON_LINE_BYTES} from '@/eve/chat-runtime-constants'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('Eve NDJSON sanitizer tee', () => {
  it('incrementally handles fragmented UTF-8/JSON, multiple lines, CRLF, blanks, and a complete trailing line', async () => {
    const source = '{"type":"message.received","data":{"message":"Hej 💸"}}\r\n\n' +
      '{"type":"session.waiting","data":{"wait":"next-user-message"}}'
    const bytes = encoder.encode(source)
    const chunks = [bytes.slice(0, 18), bytes.slice(18, 55), bytes.slice(55, 58), bytes.slice(58, 73), bytes.slice(73)]
    const persisted: number[] = []
    const output = await readText(streamChunks(chunks).pipeThrough(createNdjsonSanitizingTransform({
      startIndex: 7,
      sanitize: async raw => ({event: raw as Record<string, unknown>, approvalProjections: []}),
      persist: async ({streamIndex}) => { persisted.push(streamIndex) },
    })))

    expect(persisted).toEqual([7, 8])
    expect(output.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      {type: 'message.received', data: {message: 'Hej 💸'}},
      {type: 'session.waiting', data: {wait: 'next-user-message'}},
    ])
  })

  it.each([
    ['malformed JSON', encoder.encode('{nope}\n')],
    ['truncated trailing JSON', encoder.encode('{"type":"session.started"')],
    ['invalid UTF-8', new Uint8Array([0xc3, 0x28, 0x0a])],
    ['overlong line', encoder.encode(`${' '.repeat(CHAT_MAX_NDJSON_LINE_BYTES + 1)}\n`)],
  ])('rejects %s without persisting it', async (_label, bytes) => {
    const persist = vi.fn()
    await expect(readText(streamChunks([bytes]).pipeThrough(createNdjsonSanitizingTransform({
      startIndex: 0,
      sanitize: async raw => ({event: raw as Record<string, unknown>, approvalProjections: []}),
      persist,
    })))).rejects.toThrow()
    expect(persist).not.toHaveBeenCalled()
  })

  it('commits each sanitized positional event before emitting and never falls back to a raw or synthetic line', async () => {
    const order: string[] = []
    const rawSentinel = 'RAW_SECRET_SENTINEL'
    const stream = streamChunks([encoder.encode(
      `{"type":"one","secret":"${rawSentinel}"}\n{"type":"two","secret":"${rawSentinel}"}\n`,
    )]).pipeThrough(createNdjsonSanitizingTransform({
      startIndex: 3,
      sanitize: async raw => ({event: {type: (raw as {type: string}).type, data: {}}, approvalProjections: []}),
      persist: async ({streamIndex}) => {
        order.push(`commit:${streamIndex}`)
        if (streamIndex === 4) throw new Error('database unavailable')
      },
    }))
    const reader = stream.getReader()
    const first = await reader.read()
    expect(decoder.decode(first.value)).toBe('{"type":"one","data":{}}\n')
    await expect(reader.read()).rejects.toThrow('database unavailable')
    expect(order).toEqual(['commit:3', 'commit:4'])
    expect(JSON.stringify(first)).not.toContain(rawSentinel)
  })

  it('propagates cancellation with delayed persistence and bounded pull-controlled upstream consumption', async () => {
    let pulls = 0
    let canceled = false
    let releasePersistence!: () => void
    let persistenceStarted!: () => void
    const persistenceGate = new Promise<void>(resolve => { releasePersistence = resolve })
    const started = new Promise<void>(resolve => { persistenceStarted = resolve })
    const rawSentinel = 'CANCELED_RAW_SENTINEL'
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(encoder.encode(`{"type":"raw","secret":"${rawSentinel}"}\n`))
      },
      cancel() {
        canceled = true
      },
    })
    const persist = vi.fn(async () => {
      persistenceStarted()
      await persistenceGate
    })
    const reader = source.pipeThrough(createNdjsonSanitizingTransform({
      startIndex: 0,
      sanitize: async () => ({event: {type: 'session.started', data: {}}, approvalProjections: []}),
      persist,
    })).getReader()

    const pendingRead = reader.read()
    await started
    const cancel = reader.cancel('chat stream closed')
    const pullsAtCancel = pulls
    releasePersistence()
    await cancel
    const read = await pendingRead
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(read).toEqual({done: true, value: undefined})
    expect(canceled).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(pulls).toBe(pullsAtCancel)
    expect(pulls).toBeLessThanOrEqual(3)
    expect(JSON.stringify(read)).not.toContain(rawSentinel)
  })

  it('emits the canonical event returned by persistence for duplicate replay', async () => {
    const output = await readText(streamChunks([encoder.encode('{"type":"incoming"}\n')]).pipeThrough(
      createNdjsonSanitizingTransform({
        startIndex: 0,
        sanitize: async raw => ({event: raw as Record<string, unknown>, approvalProjections: []}),
        persist: async () => ({event: {type: 'already-committed', data: {}}}),
      }),
    ))
    expect(JSON.parse(output)).toEqual({type: 'already-committed', data: {}})
  })
})

function streamChunks(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function readText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let result = ''
  for (;;) {
    const next = await reader.read()
    if (next.done) return result
    result += decoder.decode(next.value, {stream: true})
  }
}
