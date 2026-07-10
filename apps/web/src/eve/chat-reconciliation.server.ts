import '@tanstack/react-start/server-only'

import {Client, isCurrentTurnBoundaryEvent, type SessionState} from 'eve/client'
import {
  CHAT_POST_BOUNDARY_QUIET_PERIOD_MS,
  CHAT_RECONCILIATION_TIMEOUT_MS,
} from './chat-runtime-constants'
import {
  currentChatSessionHasCommittedBoundary,
  persistMissingChatSessionFailure,
  restoreUnadmittedChatFollowUp,
  type ChatFollowUpDeliveryState,
  type ChatSessionState,
} from './chat-runtime-repository.server'
import {
  sanitizeAndPersistChatEvent,
  StaleChatRuntimeError,
} from './ndjson-transform.server'
import {mintEveChatSessionCapability} from './service-capability.server'

export type ReconcileChatMapping = {
  chatId: string
  teamId: string
  userId: string
  eveSessionId: string | null
  eveContinuationToken: string | null
  sessionOrdinal: number
  eveNextStreamIndex: number
  sessionState: ChatSessionState
  admissionId: string | null
  followUpDeliveryState: ChatFollowUpDeliveryState
  followUpPreTurnCursor: number | null
  recoverUndeliveredFollowUp?: true
}

type StreamFactoryInput = {
  origin: string
  state: SessionState
  startIndex: number
  signal: AbortSignal
  redirect: 'error'
  mintCapability: () => string
}

type ReconcilerDependencies = {
  mintChatCapability(input: {teamId: string; userId: string; chatId: string}): string
  createStream(input: StreamFactoryInput): Promise<AsyncIterable<unknown>>
  sanitizeAndPersist(input: {
    mapping: ReconcileChatMapping & {eveSessionId: string; eveContinuationToken: string}
    raw: unknown
    streamIndex: number
  }): Promise<Record<string, unknown>>
  persistMissingSessionFailure: typeof persistMissingChatSessionFailure
  hasCommittedBoundary: typeof currentChatSessionHasCommittedBoundary
  restoreUnadmittedFollowUp: typeof restoreUnadmittedChatFollowUp
  isBoundary(event: Record<string, unknown>): boolean
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  env: Partial<Record<'PENGE_EVE_BASE_URL', string>>
}

export type ChatReconciliationResult =
  | {status: 'boundary'; boundary: string; nextStreamIndex: number}
  | {status: 'timeout' | 'ended' | 'interrupted' | 'stale'; nextStreamIndex: number}
  | {status: 'restored'; nextStreamIndex: number}
  | {status: 'missing'; nextStreamIndex: number}

export function createChatReconciler(deps: ReconcilerDependencies) {
  return async function reconcileChatRuntime(mapping: ReconcileChatMapping): Promise<ChatReconciliationResult> {
    if (!mapping.eveSessionId || !mapping.eveContinuationToken) {
      return {status: 'stale', nextStreamIndex: mapping.eveNextStreamIndex}
    }
    const current = {
      ...mapping,
      eveSessionId: mapping.eveSessionId,
      eveContinuationToken: mapping.eveContinuationToken,
    }
    const abortController = new AbortController()
    const timeoutAt = Date.now() + CHAT_RECONCILIATION_TIMEOUT_MS
    let nextStreamIndex = mapping.eveNextStreamIndex
    let boundary: string | null = null
    let quietAt: number | null = null
    let latestAttemptEndedCleanly = false

    const mappedBoundaryState = boundaryState(mapping.sessionState)
    if (mappedBoundaryState) {
      try {
        if (await deps.hasCommittedBoundary({
          chatId: mapping.chatId,
          eveSessionId: current.eveSessionId,
          sessionOrdinal: mapping.sessionOrdinal,
          state: mappedBoundaryState,
        })) {
          boundary = `session.${mappedBoundaryState}`
          return {status: 'boundary', boundary, nextStreamIndex}
        }
      } catch {
        return {status: 'interrupted', nextStreamIndex}
      }
    }

    const origin = configuredEveOrigin(deps.env.PENGE_EVE_BASE_URL)
    if (!origin) return {status: 'interrupted', nextStreamIndex}

    const mintCapability = () => deps.mintChatCapability({
      teamId: mapping.teamId,
      userId: mapping.userId,
      chatId: mapping.chatId,
    })

    while (Date.now() < timeoutAt) {
      let source: AsyncIterable<unknown>
      latestAttemptEndedCleanly = false
      try {
        const creation = await racePromiseWithDeadline(
          deps.createStream({
            origin,
            state: {
              sessionId: current.eveSessionId,
              continuationToken: current.eveContinuationToken,
              streamIndex: nextStreamIndex,
            },
            startIndex: nextStreamIndex,
            signal: abortController.signal,
            redirect: 'error',
            mintCapability,
          }),
          Math.max(0, timeoutAt - Date.now()),
          deps,
        )
        if (creation.kind === 'deadline') {
          abortController.abort()
          return finishReconciliationDeadline(deps, mapping, nextStreamIndex, false)
        }
        source = creation.value
      } catch (error) {
        return handleReconciliationError(deps, current, nextStreamIndex, error)
      }

      const iterator = source[Symbol.asyncIterator]()
      let persisting = false
      try {
        while (true) {
          const deadline = Math.min(timeoutAt, quietAt ?? Number.POSITIVE_INFINITY)
          const outcome = await raceIteratorWithDeadline(
            iterator.next(),
            Math.max(0, deadline - Date.now()),
            deps,
          )
          if (outcome.kind === 'deadline') {
            abortController.abort()
            void iterator.return?.().catch(() => undefined)
            if (quietAt !== null && Date.now() >= quietAt && boundary) {
              return {status: 'boundary', boundary, nextStreamIndex}
            }
            return finishReconciliationDeadline(deps, mapping, nextStreamIndex, latestAttemptEndedCleanly)
          }
          if (outcome.value.done) {
            latestAttemptEndedCleanly = true
            break
          }

          persisting = true
          const committed = await deps.sanitizeAndPersist({
            mapping: current,
            raw: outcome.value.value,
            streamIndex: nextStreamIndex,
          })
          persisting = false
          nextStreamIndex += 1
          if (deps.isBoundary(committed)) boundary = String(committed.type)
          if (boundary) quietAt = Date.now() + CHAT_POST_BOUNDARY_QUIET_PERIOD_MS
        }
      } catch (error) {
        abortController.abort()
        void iterator.return?.().catch(() => undefined)
        if (persisting) {
          return isStalePersistenceError(error)
            ? {status: 'stale', nextStreamIndex}
            : {status: 'interrupted', nextStreamIndex}
        }
        return handleReconciliationError(deps, current, nextStreamIndex, error)
      }

      if (boundary) {
        const confirmationAt = quietAt ?? Date.now() + CHAT_POST_BOUNDARY_QUIET_PERIOD_MS
        const confirmationDeadline = Math.min(confirmationAt, timeoutAt)
        if (confirmationDeadline > Date.now()) await delay(confirmationDeadline - Date.now(), deps)
        return confirmationAt <= timeoutAt
          ? {status: 'boundary', boundary, nextStreamIndex}
          : {status: 'timeout', nextStreamIndex}
      }

      const reopenAt = Math.min(Date.now() + CHAT_POST_BOUNDARY_QUIET_PERIOD_MS, timeoutAt)
      if (reopenAt > Date.now()) await delay(reopenAt - Date.now(), deps)
    }

    abortController.abort()
    return finishReconciliationDeadline(deps, mapping, nextStreamIndex, latestAttemptEndedCleanly)
  }
}

export const reconcileChatRuntime = createChatReconciler({
  mintChatCapability: mintEveChatSessionCapability,
  createStream: async input => {
    const client = new Client({
      host: input.origin,
      auth: {bearer: input.mintCapability},
      redirect: input.redirect,
      maxReconnectAttempts: 0,
      preserveCompletedSessions: true,
    })
    return client.session(input.state).stream({startIndex: input.startIndex, signal: input.signal})
  },
  sanitizeAndPersist: input => sanitizeAndPersistChatEvent({
    chatId: input.mapping.chatId,
    eveSessionId: input.mapping.eveSessionId,
    sessionOrdinal: input.mapping.sessionOrdinal,
    scope: {teamId: input.mapping.teamId, userId: input.mapping.userId},
  }, input.raw, input.streamIndex),
  persistMissingSessionFailure: persistMissingChatSessionFailure,
  hasCommittedBoundary: currentChatSessionHasCommittedBoundary,
  restoreUnadmittedFollowUp: restoreUnadmittedChatFollowUp,
  isBoundary: event => isCurrentTurnBoundaryEvent(event as never),
  setTimeout,
  clearTimeout,
  env: process.env,
})

/**
 * Eve 0.22.1 awaits durable delivery-hook admission before the follow-up POST receipt. The
 * admitted payload then starts the durable turn preamble (`turn.started` before model work), so
 * any public stream advance from the captured cursor proves delivery. Acknowledged receipts are
 * conclusive on their own; only an unacknowledged marker plus a clean, unchanged stream may reset.
 */
async function finishReconciliationDeadline(
  deps: ReconcilerDependencies,
  mapping: ReconcileChatMapping,
  nextStreamIndex: number,
  latestAttemptEndedCleanly: boolean,
): Promise<ChatReconciliationResult> {
  if (
    !latestAttemptEndedCleanly || !mapping.recoverUndeliveredFollowUp ||
    mapping.sessionState !== 'running' || !mapping.eveSessionId ||
    !mapping.admissionId || mapping.followUpPreTurnCursor === null ||
    mapping.eveNextStreamIndex !== mapping.followUpPreTurnCursor ||
    nextStreamIndex !== mapping.followUpPreTurnCursor ||
    mapping.followUpDeliveryState !== 'ambiguous'
  ) return {status: 'timeout', nextStreamIndex}

  try {
    const restored = await deps.restoreUnadmittedFollowUp({
      chatId: mapping.chatId,
      eveSessionId: mapping.eveSessionId,
      sessionOrdinal: mapping.sessionOrdinal,
      admissionId: mapping.admissionId,
      preTurnCursor: mapping.followUpPreTurnCursor,
    })
    return restored
      ? {status: 'restored', nextStreamIndex}
      : {status: 'stale', nextStreamIndex}
  } catch {
    return {status: 'interrupted', nextStreamIndex}
  }
}

async function handleReconciliationError(
  deps: ReconcilerDependencies,
  mapping: ReconcileChatMapping & {eveSessionId: string; eveContinuationToken: string},
  streamIndex: number,
  error: unknown,
): Promise<ChatReconciliationResult> {
  if (isStalePersistenceError(error)) {
    return {status: 'stale', nextStreamIndex: streamIndex}
  }
  if (readStatus(error) !== 404) return {status: 'interrupted', nextStreamIndex: streamIndex}

  try {
    const persisted = await deps.persistMissingSessionFailure({
      chatId: mapping.chatId,
      eveSessionId: mapping.eveSessionId,
      sessionOrdinal: mapping.sessionOrdinal,
      streamIndex,
    })
    return persisted
      ? {status: 'missing', nextStreamIndex: streamIndex + 1}
      : {status: 'stale', nextStreamIndex: streamIndex}
  } catch {
    return {status: 'interrupted', nextStreamIndex: streamIndex}
  }
}

function isStalePersistenceError(error: unknown) {
  return error instanceof StaleChatRuntimeError ||
    (error instanceof Error && error.message === 'Chat runtime session changed during stream persistence')
}

function boundaryState(state: ChatSessionState) {
  return state === 'waiting' || state === 'completed' || state === 'failed' ? state : null
}

function readStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : null
}

function raceIteratorWithDeadline(
  next: Promise<IteratorResult<unknown>>,
  delayMs: number,
  deps: Pick<ReconcilerDependencies, 'setTimeout' | 'clearTimeout'>,
) {
  return racePromiseWithDeadline(next, delayMs, deps)
}

function racePromiseWithDeadline<T>(
  promise: Promise<T>,
  delayMs: number,
  deps: Pick<ReconcilerDependencies, 'setTimeout' | 'clearTimeout'>,
): Promise<{kind: 'next'; value: T} | {kind: 'deadline'}> {
  return new Promise((resolve, reject) => {
    const timer = deps.setTimeout(() => resolve({kind: 'deadline'}), delayMs)
    promise.then(
      value => {
        deps.clearTimeout(timer)
        resolve({kind: 'next', value})
      },
      error => {
        deps.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function delay(ms: number, deps: Pick<ReconcilerDependencies, 'setTimeout'>) {
  return new Promise<void>(resolve => deps.setTimeout(resolve, ms))
}

function configuredEveOrigin(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) return null
    return url.origin
  } catch {
    return null
  }
}
