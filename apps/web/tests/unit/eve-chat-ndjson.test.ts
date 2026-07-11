import {describe, expect, it} from 'vitest'
import {CHAT_MAX_NDJSON_LINE_BYTES, createChatEventNdjsonTransform} from '@/eve/ndjson-transform.server'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const scope = {teamId: 'team-1', userId: 'user-1'}

describe('Eve NDJSON sanitizer', () => {
  it('preserves one output line per input event across fragmented UTF-8 and CRLF', async () => {
    const source = `${JSON.stringify({type: 'message.received', data: {message: 'Hej 💸', sequence: 1, turnId: 'turn-1'}})}\r\n${JSON.stringify({type: 'session.waiting', data: {wait: 'next-user-message'}})}`
    const bytes = encoder.encode(source)
    const output = await readText(streamChunks([bytes.slice(0, 20), bytes.slice(20, 53), bytes.slice(53)]).pipeThrough(createChatEventNdjsonTransform({scope})))
    expect(output.trim().split('\n')).toHaveLength(2)
    expect(output).toContain('Hej 💸')
    expect(output).toContain('session.waiting')
  })

  it('rejects malformed, invalid UTF-8, and overlong lines', async () => {
    for (const bytes of [
      encoder.encode('{nope}\n'),
      new Uint8Array([0xc3, 0x28, 0x0a]),
      encoder.encode(`${' '.repeat(CHAT_MAX_NDJSON_LINE_BYTES + 1)}\n`),
    ]) {
      await expect(readText(streamChunks([bytes]).pipeThrough(createChatEventNdjsonTransform({scope})))).rejects.toThrow()
    }
  })

  it('redacts tool input without any persistence dependency', async () => {
    const raw = {type: 'actions.requested', data: {sequence: 1, stepIndex: 0, turnId: 'turn-1', actions: [{kind: 'tool-call', callId: 'call-1', toolName: 'manageCategory', input: {secret: 'raw-secret'}}]}}
    const output = await readText(streamChunks([encoder.encode(`${JSON.stringify(raw)}\n`)]).pipeThrough(createChatEventNdjsonTransform({scope})))
    expect(output).not.toContain('raw-secret')
    expect(output).toContain('manageCategory')
  })
})

function streamChunks(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() }})
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
