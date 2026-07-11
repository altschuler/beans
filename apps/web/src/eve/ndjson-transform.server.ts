import '@tanstack/react-start/server-only'

import {sanitizeChatEvent} from './chat-event-sanitizer.server'
import type {TrustedTeamScope} from '@penge/domain/team-scope'

export const CHAT_MAX_NDJSON_LINE_BYTES = 1024 * 1024

export function createChatEventNdjsonTransform(options: {scope: TrustedTeamScope}) {
  let line: number[] = []
  const decoder = new TextDecoder('utf-8', {fatal: true})
  const encoder = new TextEncoder()

  const processLine = async (controller: TransformStreamDefaultController<Uint8Array>) => {
    let bytes = Uint8Array.from(line)
    line = []
    if (bytes.at(-1) === 0x0d) bytes = bytes.slice(0, -1)
    if (bytes.length === 0) return

    let raw: unknown
    try {
      raw = JSON.parse(decoder.decode(bytes))
    } catch {
      throw new Error('Eve stream contained malformed NDJSON')
    }
    const sanitized = await sanitizeChatEvent(raw, {scope: options.scope})
    controller.enqueue(encoder.encode(`${JSON.stringify(sanitized.event)}\n`))
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      for (const byte of chunk) {
        if (byte === 0x0a) {
          await processLine(controller)
        } else {
          line.push(byte)
          if (line.length > CHAT_MAX_NDJSON_LINE_BYTES) {
            throw new Error('Eve stream NDJSON line exceeded the maximum size')
          }
        }
      }
    },
    async flush(controller) {
      if (line.length > 0) await processLine(controller)
    },
  })
}
