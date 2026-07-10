import {isCurrentTurnBoundaryEvent, type ClientSession, type HandleMessageStreamEvent} from 'eve/client'

export type ChatStreamStop =
  | {kind: 'boundary'}
  | {kind: 'eof'}
  | {kind: 'aborted'}
  | {kind: 'error'; error: unknown}

export class EveChatStreamController {
  #active: Promise<ChatStreamStop> | null = null
  #settled: Promise<void> | null = null
  #abortController: AbortController | null = null

  get active() {
    return this.#active !== null
  }

  attach(input: {
    session: ClientSession
    startIndex: number
    onEvent(event: HandleMessageStreamEvent, streamIndex: number): void
    onStop(outcome: ChatStreamStop): void
  }) {
    if (this.#active) return this.#active
    const controller = new AbortController()
    this.#abortController = controller
    const run = (async (): Promise<ChatStreamStop> => {
      let streamIndex = input.startIndex
      try {
        for await (const event of input.session.stream({startIndex: input.startIndex, signal: controller.signal})) {
          if (controller.signal.aborted) return {kind: 'aborted'}
          input.onEvent(event, streamIndex)
          streamIndex += 1
          if (isCurrentTurnBoundaryEvent(event)) return {kind: 'boundary'}
        }
        return controller.signal.aborted ? {kind: 'aborted'} : {kind: 'eof'}
      } catch (error) {
        return controller.signal.aborted ? {kind: 'aborted'} : {kind: 'error', error}
      }
    })()
    this.#active = run
    const settled = run.then(outcome => {
      try {
        input.onStop(outcome)
      } catch {
        // UI observers cannot make an already-settled stream promise unhandled.
      }
    }).catch(() => undefined).finally(() => {
      if (this.#abortController === controller) this.#abortController = null
      if (this.#active === run) this.#active = null
      if (this.#settled === settled) this.#settled = null
    })
    this.#settled = settled
    return run
  }

  stop() {
    this.#abortController?.abort()
    return this.#settled ?? Promise.resolve()
  }
}
