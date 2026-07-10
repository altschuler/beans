import '@tanstack/react-start/server-only'

import {CHAT_MAX_NDJSON_LINE_BYTES} from './chat-runtime-constants'
import {sanitizeChatEvent} from './chat-event-sanitizer.server'
import {persistChatRuntimeEvent} from './chat-runtime-repository.server'
import type {TrustedTeamScope} from '@penge/domain/team-scope'

export type ChatEventPersistenceContext = {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  scope: TrustedTeamScope
  now?: () => Date
}

export class StaleChatRuntimeError extends Error {
  constructor() {
    super('Chat runtime session changed during stream persistence')
    this.name = 'StaleChatRuntimeError'
  }
}

export type NdjsonSanitizedEvent = {
  event: Record<string, unknown>
  approvalProjections: unknown[]
}

type TransformOptions<TSanitized extends NdjsonSanitizedEvent> = {
  startIndex: number
  sanitize: (raw: unknown, streamIndex: number) => Promise<TSanitized>
  persist: (input: {streamIndex: number; sanitized: TSanitized}) => Promise<void | {event: Record<string, unknown>}>
  processEvent?: (raw: unknown, streamIndex: number) => Promise<Record<string, unknown>>
}

export async function sanitizeAndPersistChatEvent(
  context: ChatEventPersistenceContext,
  raw: unknown,
  streamIndex: number,
) {
  const sanitized = await sanitizeChatEvent(raw, {scope: context.scope})
  const result = await persistChatRuntimeEvent({
    chatId: context.chatId,
    eveSessionId: context.eveSessionId,
    sessionOrdinal: context.sessionOrdinal,
    streamIndex,
    sanitized,
    createdAt: context.now?.() ?? new Date(),
  })
  if (result.status === 'stale') throw new StaleChatRuntimeError()
  return result.event
}

export function createChatEventNdjsonTransform(options: ChatEventPersistenceContext & {startIndex: number}) {
  return createNdjsonSanitizingTransform({
    startIndex: options.startIndex,
    // The generic callbacks remain required for focused parser tests; production takes the shared
    // one-step path so proxy streaming and reconciliation cannot drift.
    sanitize: raw => sanitizeChatEvent(raw, {scope: options.scope}),
    persist: async () => undefined,
    processEvent: (raw, streamIndex) => sanitizeAndPersistChatEvent(options, raw, streamIndex),
  })
}

export function createNdjsonSanitizingTransform<TSanitized extends NdjsonSanitizedEvent>(
  options: TransformOptions<TSanitized>,
) {
  if (!Number.isSafeInteger(options.startIndex) || options.startIndex < 0) {
    throw new Error('Invalid Eve stream start index')
  }

  let streamIndex = options.startIndex
  let line: number[] = []
  const decoder = new TextDecoder('utf-8', {fatal: true})
  const encoder = new TextEncoder()

  const processLine = async (controller: TransformStreamDefaultController<Uint8Array>) => {
    let bytes = Uint8Array.from(line)
    line = []
    if (bytes.at(-1) === 0x0d) bytes = bytes.slice(0, -1)

    let text: string
    try {
      text = decoder.decode(bytes)
    } catch {
      throw new Error('Eve stream contained invalid UTF-8')
    }
    if (text.trim().length === 0) return

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('Eve stream contained malformed NDJSON')
    }

    const positionalIndex = streamIndex
    const event = options.processEvent
      ? await options.processEvent(raw, positionalIndex)
      : await (async () => {
          const sanitized = await options.sanitize(raw, positionalIndex)
          const persisted = await options.persist({streamIndex: positionalIndex, sanitized})
          return persisted?.event ?? sanitized.event
        })()
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    streamIndex += 1
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      for (const byte of chunk) {
        if (byte === 0x0a) {
          await processLine(controller)
          continue
        }
        line.push(byte)
        if (line.length > CHAT_MAX_NDJSON_LINE_BYTES) {
          throw new Error('Eve stream NDJSON line exceeded the maximum size')
        }
      }
    },
    async flush(controller) {
      if (line.length > 0) await processLine(controller)
    },
  })
}
