import '@tanstack/react-start/server-only'

import {ensureSession} from '@/auth/session'
import {
  getAuthorizedChatRuntimeMapping,
  promoteStalePendingChatFollowUp,
  reapStaleChatAdmissions,
  type ChatSessionState,
} from './chat-runtime-repository.server'
import {
  reconcileChatRuntime,
  type ChatReconciliationResult,
  type ReconcileChatMapping,
} from './chat-reconciliation.server'
import {
  CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS,
  CHAT_STALE_RUNNING_RECONCILIATION_MS,
} from './chat-runtime-constants'

type BootstrapDependencies = {
  ensureSession(): Promise<{user: {id: string}}>
  getAuthorizedChatRuntimeMapping: typeof getAuthorizedChatRuntimeMapping
  reapStaleChatAdmissions: typeof reapStaleChatAdmissions
  promoteStalePendingChatFollowUp: typeof promoteStalePendingChatFollowUp
  reconcileChatRuntime(mapping: ReconcileChatMapping): Promise<ChatReconciliationResult>
  now(): Date
}

type BootstrapSession =
  | {sessionId: string; continuationToken: string; streamIndex: number}
  | {streamIndex: 0}
  | null

export type ChatBootstrapResult = {
  session: BootstrapSession
  sessionOrdinal: number
  sessionState: ChatSessionState | 'reconnecting'
  requiredEventCursor: {sessionOrdinal: number; streamIndex: number}
}

export function createChatBootstrapHandler(deps: BootstrapDependencies) {
  return async function bootstrapChat(input: {chatId: string}): Promise<ChatBootstrapResult> {
    const session = await deps.ensureSession()
    let mapping = await deps.getAuthorizedChatRuntimeMapping({chatId: input.chatId, userId: session.user.id})
    if (!mapping) throw new Error('Not found')

    if (mapping.sessionState === 'admitting') {
      await deps.reapStaleChatAdmissions({now: deps.now()})
      mapping = await deps.getAuthorizedChatRuntimeMapping({chatId: input.chatId, userId: session.user.id})
      if (!mapping) throw new Error('Not found')
    }

    const now = deps.now()
    const pendingDispatchExpired = mapping.sessionState === 'running' &&
      mapping.followUpDeliveryState === 'pending' &&
      mapping.turnStartedAt !== null &&
      now.getTime() - mapping.turnStartedAt.getTime() > CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS
    const pendingTurnStartedAt = mapping.turnStartedAt
    if (
      pendingDispatchExpired && mapping.eveSessionId && mapping.admissionId &&
      mapping.followUpPreTurnCursor !== null && pendingTurnStartedAt
    ) {
      await deps.promoteStalePendingChatFollowUp({
        chatId: mapping.chatId,
        eveSessionId: mapping.eveSessionId,
        sessionOrdinal: mapping.sessionOrdinal,
        admissionId: mapping.admissionId,
        preTurnCursor: mapping.followUpPreTurnCursor,
        turnStartedAt: pendingTurnStartedAt,
        now,
      })
      mapping = await deps.getAuthorizedChatRuntimeMapping({chatId: input.chatId, userId: session.user.id})
      if (!mapping) throw new Error('Not found')
    }

    const staleRunning = mapping.sessionState === 'running' &&
      mapping.followUpDeliveryState !== 'pending' && (
        !mapping.turnStartedAt ||
        now.getTime() - mapping.turnStartedAt.getTime() > CHAT_STALE_RUNNING_RECONCILIATION_MS
      )
    const catchUpMappedSession = mapping.sessionState === 'waiting' ||
      mapping.sessionState === 'completed' ||
      mapping.sessionState === 'failed'
    if (
      mapping.eveSessionId && mapping.eveContinuationToken &&
      (staleRunning || catchUpMappedSession)
    ) {
      const reconciliation = await deps.reconcileChatRuntime(staleRunning && mapping.followUpDeliveryState === 'ambiguous'
        ? {...mapping, recoverUndeliveredFollowUp: true}
        : mapping)
      mapping = await deps.getAuthorizedChatRuntimeMapping({chatId: input.chatId, userId: session.user.id})
      if (!mapping) throw new Error('Not found')
      if (['timeout', 'ended', 'interrupted', 'stale'].includes(reconciliation.status)) {
        return {
          session: null,
          sessionOrdinal: mapping.sessionOrdinal,
          sessionState: 'reconnecting',
          requiredEventCursor: {
            sessionOrdinal: mapping.sessionOrdinal,
            streamIndex: mapping.eveNextStreamIndex,
          },
        }
      }
    }

    return toBootstrapResult(mapping)
  }
}

export const bootstrapChat = createChatBootstrapHandler({
  ensureSession,
  getAuthorizedChatRuntimeMapping,
  reapStaleChatAdmissions,
  promoteStalePendingChatFollowUp,
  reconcileChatRuntime,
  now: () => new Date(),
})

function toBootstrapResult(mapping: Exclude<Awaited<ReturnType<typeof getAuthorizedChatRuntimeMapping>>, null>): ChatBootstrapResult {
  const requiredEventCursor = {
    sessionOrdinal: mapping.sessionOrdinal,
    streamIndex: mapping.eveNextStreamIndex,
  }

  if (mapping.sessionState === 'admitting') {
    return {
      session: null,
      sessionOrdinal: mapping.sessionOrdinal,
      sessionState: mapping.sessionState,
      requiredEventCursor,
    }
  }

  if (mapping.sessionState === 'waiting' || mapping.sessionState === 'running') {
    if (!mapping.eveSessionId || !mapping.eveContinuationToken) throw new Error('Not found')
    return {
      session: {
        sessionId: mapping.eveSessionId,
        continuationToken: mapping.eveContinuationToken,
        streamIndex: mapping.eveNextStreamIndex,
      },
      sessionOrdinal: mapping.sessionOrdinal,
      sessionState: mapping.sessionState,
      requiredEventCursor,
    }
  }

  return {
    session: {streamIndex: 0},
    sessionOrdinal: mapping.sessionOrdinal,
    sessionState: mapping.sessionState,
    requiredEventCursor,
  }
}
