import '@tanstack/react-start/server-only'

import {and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL} from 'drizzle-orm'
import {db} from '@/db/client'
import {
  CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS,
  CHAT_STALE_ADMISSION_CUTOFF_MS,
} from './chat-runtime-constants'
import {
  teamDataAssistantChatApprovals,
  teamDataAssistantChatEvents,
  teamDataAssistantChats,
  teamMembers,
} from '@penge/domain/schema'
import {safeChatProposalSchema} from '@penge/domain/eve-chat-approval'
import {createMissingChatSessionFailureEvent, type SanitizedChatEvent} from './chat-event-sanitizer.server'

export type ChatSessionState = 'none' | 'admitting' | 'running' | 'waiting' | 'completed' | 'failed'
export type ChatFollowUpDeliveryState = 'none' | 'pending' | 'ambiguous' | 'acknowledged'
type ChatBoundaryState = Extract<ChatSessionState, 'waiting' | 'completed' | 'failed'>
const CONTIGUOUS_EVENT_BATCH_SIZE = 128
const STALE_ADMISSION_REAP_BATCH_SIZE = 100

const runtimeMappingSelection = {
  chatId: teamDataAssistantChats.id,
  teamId: teamDataAssistantChats.teamId,
  userId: teamDataAssistantChats.userId,
  eveSessionId: teamDataAssistantChats.eveSessionId,
  eveContinuationToken: teamDataAssistantChats.eveContinuationToken,
  sessionOrdinal: teamDataAssistantChats.eveSessionOrdinal,
  eveNextStreamIndex: teamDataAssistantChats.eveNextStreamIndex,
  sessionState: teamDataAssistantChats.eveSessionState,
  turnStartedAt: teamDataAssistantChats.eveTurnStartedAt,
  admissionId: teamDataAssistantChats.eveAdmissionId,
  followUpDeliveryState: teamDataAssistantChats.eveFollowUpDeliveryState,
  followUpPreTurnCursor: teamDataAssistantChats.eveFollowUpPreTurnCursor,
}

export async function getAuthorizedChatRuntimeMapping(input: {chatId: string; userId: string}) {
  const [mapping] = await db
    .select(runtimeMappingSelection)
    .from(teamDataAssistantChats)
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, teamDataAssistantChats.teamId),
        eq(teamMembers.userId, input.userId),
      ),
    )
    .where(and(eq(teamDataAssistantChats.id, input.chatId), eq(teamDataAssistantChats.userId, input.userId)))
    .limit(1)
  return mapping ? normalizeRuntimeMapping(mapping) : null
}

export async function currentChatSessionHasCommittedBoundary(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  state: Extract<ChatSessionState, 'waiting' | 'completed' | 'failed'>
}) {
  const [event] = await db
    .select({id: teamDataAssistantChatEvents.id})
    .from(teamDataAssistantChatEvents)
    .innerJoin(teamDataAssistantChats, and(
      eq(teamDataAssistantChats.id, teamDataAssistantChatEvents.chatId),
      currentSessionCondition(input, eq(teamDataAssistantChats.eveSessionState, input.state)),
    ))
    .where(and(
      eq(teamDataAssistantChatEvents.chatId, input.chatId),
      eq(teamDataAssistantChatEvents.eveSessionId, input.eveSessionId),
      eq(teamDataAssistantChatEvents.sessionOrdinal, input.sessionOrdinal),
      eq(teamDataAssistantChatEvents.type, `session.${input.state}`),
      sql`${teamDataAssistantChatEvents.streamIndex} < ${teamDataAssistantChats.eveNextStreamIndex}`,
    ))
    .limit(1)
  return Boolean(event)
}

export function currentChatSessionHasCommittedTerminalBoundary(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  state: Extract<ChatSessionState, 'completed' | 'failed'>
}) {
  return currentChatSessionHasCommittedBoundary(input)
}

export async function reserveChatSessionStart(input: {
  chatId: string
  now?: Date
  admissionId?: string
  expectedTerminal?: {
    eveSessionId: string
    sessionOrdinal: number
    sessionState: Extract<ChatSessionState, 'completed' | 'failed'>
    eveNextStreamIndex: number
  }
}) {
  const now = input.now ?? new Date()
  const admissionId = input.admissionId ?? crypto.randomUUID()
  const [reserved] = await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionId: null,
      eveContinuationToken: null,
      eveSessionOrdinal: sql`${teamDataAssistantChats.eveSessionOrdinal} + 1`,
      eveNextStreamIndex: 0,
      eveSessionState: 'admitting',
      eveTurnStartedAt: now,
      eveAdmissionId: admissionId,
      eveFollowUpDeliveryState: 'none',
      eveFollowUpPreTurnCursor: null,
      updatedAt: now,
    })
    .where(and(
      eq(teamDataAssistantChats.id, input.chatId),
      input.expectedTerminal ? and(
        eq(teamDataAssistantChats.eveSessionId, input.expectedTerminal.eveSessionId),
        eq(teamDataAssistantChats.eveSessionOrdinal, input.expectedTerminal.sessionOrdinal),
        eq(teamDataAssistantChats.eveSessionState, input.expectedTerminal.sessionState),
        eq(teamDataAssistantChats.eveNextStreamIndex, input.expectedTerminal.eveNextStreamIndex),
      ) : undefined,
      or(
        and(
          eq(teamDataAssistantChats.eveSessionState, 'none'),
          isNull(teamDataAssistantChats.eveSessionId),
          isNull(teamDataAssistantChats.eveContinuationToken),
        ),
        and(
          eq(teamDataAssistantChats.eveSessionState, 'failed'),
          isNull(teamDataAssistantChats.eveSessionId),
          isNull(teamDataAssistantChats.eveContinuationToken),
        ),
        sql`exists (
          select 1
          from team_data_assistant_chat_events terminal_event
          where terminal_event.chat_id = ${teamDataAssistantChats.id}
            and terminal_event.eve_session_id = ${teamDataAssistantChats.eveSessionId}
            and terminal_event.session_ordinal = ${teamDataAssistantChats.eveSessionOrdinal}
            and terminal_event.stream_index < ${teamDataAssistantChats.eveNextStreamIndex}
            and terminal_event.type = 'session.' || ${teamDataAssistantChats.eveSessionState}
            and ${teamDataAssistantChats.eveSessionState} in ('completed', 'failed')
        )`,
      ),
    ))
    .returning(runtimeMappingSelection)
  return reserved ? normalizeRuntimeMapping(reserved) : null
}

export async function reserveChatFollowUp(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  now?: Date
  admissionId?: string
}) {
  const now = input.now ?? new Date()
  const admissionId = input.admissionId ?? crypto.randomUUID()
  const [reserved] = await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionState: 'running',
      eveTurnStartedAt: now,
      eveAdmissionId: admissionId,
      eveFollowUpDeliveryState: 'pending',
      eveFollowUpPreTurnCursor: teamDataAssistantChats.eveNextStreamIndex,
      updatedAt: now,
    })
    .where(currentSessionCondition(input, eq(teamDataAssistantChats.eveSessionState, 'waiting')))
    .returning(runtimeMappingSelection)
  return reserved ? normalizeRuntimeMapping(reserved) : null
}

export async function attachChatSessionStart(input: {
  chatId: string
  sessionOrdinal: number
  admissionId: string
  eveSessionId: string
  eveContinuationToken: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const [attached] = await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionId: input.eveSessionId,
      eveContinuationToken: input.eveContinuationToken,
      eveSessionState: 'running',
      eveAdmissionId: null,
      eveFollowUpDeliveryState: 'none',
      eveFollowUpPreTurnCursor: null,
      updatedAt: now,
    })
    .where(and(
      eq(teamDataAssistantChats.id, input.chatId),
      eq(teamDataAssistantChats.eveSessionOrdinal, input.sessionOrdinal),
      eq(teamDataAssistantChats.eveAdmissionId, input.admissionId),
      eq(teamDataAssistantChats.eveSessionState, 'admitting'),
      isNull(teamDataAssistantChats.eveSessionId),
    ))
    .returning(runtimeMappingSelection)
  return attached ? normalizeRuntimeMapping(attached) : null
}

export async function releaseDefinitiveChatStartRejection(input: {
  chatId: string
  sessionOrdinal: number
  admissionId: string
  now?: Date
}) {
  const [released] = await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionState: 'failed',
      eveTurnStartedAt: null,
      eveAdmissionId: null,
      eveFollowUpDeliveryState: 'none',
      eveFollowUpPreTurnCursor: null,
      updatedAt: input.now ?? new Date(),
    })
    .where(and(
      eq(teamDataAssistantChats.id, input.chatId),
      eq(teamDataAssistantChats.eveSessionOrdinal, input.sessionOrdinal),
      eq(teamDataAssistantChats.eveAdmissionId, input.admissionId),
      eq(teamDataAssistantChats.eveSessionState, 'admitting'),
      isNull(teamDataAssistantChats.eveSessionId),
    ))
    .returning({id: teamDataAssistantChats.id})
  return Boolean(released)
}

export type ChatApprovalResponse = {
  requestId: string
  optionId: 'approve' | 'deny'
}

export async function promoteStalePendingChatFollowUp(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  admissionId: string
  preTurnCursor: number
  turnStartedAt: Date
  now?: Date
}) {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS)
  const [promoted] = await db
    .update(teamDataAssistantChats)
    .set({eveFollowUpDeliveryState: 'ambiguous', updatedAt: now})
    .where(currentFollowUpLeaseCondition(input, and(
      eq(teamDataAssistantChats.eveFollowUpDeliveryState, 'pending'),
      lt(teamDataAssistantChats.eveTurnStartedAt, cutoff),
    )))
    .returning({id: teamDataAssistantChats.id})
  return Boolean(promoted)
}

export async function markChatFollowUpDeliveryAmbiguous(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  admissionId: string
  preTurnCursor: number
  now?: Date
}) {
  return updateChatFollowUpDeliveryState(input, ['pending', 'ambiguous'], 'ambiguous')
}

export type ChatFollowUpDeliveryAcknowledgementResult =
  | {status: 'acknowledged'}
  | {status: 'proven-delivery'}
  | {status: 'stale'}

export async function markChatFollowUpDeliveryAcknowledged(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  admissionId: string
  preTurnCursor: number
  now?: Date
}): Promise<ChatFollowUpDeliveryAcknowledgementResult> {
  return db.transaction(async transaction => {
    const [updated] = await transaction
      .update(teamDataAssistantChats)
      .set({eveFollowUpDeliveryState: 'acknowledged', updatedAt: input.now ?? new Date()})
      .where(currentFollowUpDeliveryCondition(input, inArray(
        teamDataAssistantChats.eveFollowUpDeliveryState,
        ['pending', 'ambiguous', 'acknowledged'],
      )))
      .returning({id: teamDataAssistantChats.id})
    if (updated) return {status: 'acknowledged'}

    const [current] = await transaction
      .select({
        eveSessionId: teamDataAssistantChats.eveSessionId,
        eveContinuationToken: teamDataAssistantChats.eveContinuationToken,
        sessionOrdinal: teamDataAssistantChats.eveSessionOrdinal,
        nextStreamIndex: teamDataAssistantChats.eveNextStreamIndex,
        sessionState: teamDataAssistantChats.eveSessionState,
      })
      .from(teamDataAssistantChats)
      .where(eq(teamDataAssistantChats.id, input.chatId))
      .limit(1)
    const exactHandles = current?.eveSessionId === input.eveSessionId &&
      current.eveContinuationToken !== null &&
      current.sessionOrdinal === input.sessionOrdinal
    return exactHandles && Boolean(current && current.nextStreamIndex > input.preTurnCursor)
      ? {status: 'proven-delivery'}
      : {status: 'stale'}
  })
}

async function updateChatFollowUpDeliveryState(
  input: {
    chatId: string
    eveSessionId: string
    sessionOrdinal: number
    admissionId: string
    preTurnCursor: number
    now?: Date
  },
  from: ChatFollowUpDeliveryState[],
  state: Exclude<ChatFollowUpDeliveryState, 'none'>,
) {
  const [updated] = await db
    .update(teamDataAssistantChats)
    .set({eveFollowUpDeliveryState: state, updatedAt: input.now ?? new Date()})
    .where(currentFollowUpDeliveryCondition(input, inArray(teamDataAssistantChats.eveFollowUpDeliveryState, from)))
    .returning({id: teamDataAssistantChats.id})
  return Boolean(updated)
}

export async function restoreUnadmittedChatFollowUp(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  admissionId: string
  preTurnCursor: number
  now?: Date
}) {
  return db.transaction(async transaction => {
    const [current] = await transaction
      .select({id: teamDataAssistantChats.id})
      .from(teamDataAssistantChats)
      .where(currentFollowUpDeliveryCondition(input, and(
        eq(teamDataAssistantChats.eveNextStreamIndex, input.preTurnCursor),
        eq(teamDataAssistantChats.eveFollowUpDeliveryState, 'ambiguous'),
      )))
      .for('update')
      .limit(1)
    if (!current) return false

    await transaction
      .update(teamDataAssistantChatApprovals)
      .set({resolutionStatus: 'pending', eveClaimedByAdmissionId: null, updatedAt: input.now ?? new Date()})
      .where(and(
        exactApprovalSessionCondition(input),
        eq(teamDataAssistantChatApprovals.eveClaimedByAdmissionId, input.admissionId),
        inArray(teamDataAssistantChatApprovals.resolutionStatus, ['approved', 'denied']),
      ))

    const [restored] = await transaction
      .update(teamDataAssistantChats)
      .set({
        eveSessionState: 'waiting',
        eveTurnStartedAt: null,
        eveAdmissionId: null,
        eveFollowUpDeliveryState: 'none',
        eveFollowUpPreTurnCursor: null,
        updatedAt: input.now ?? new Date(),
      })
      .where(currentFollowUpDeliveryCondition(input, and(
        eq(teamDataAssistantChats.eveNextStreamIndex, input.preTurnCursor),
        eq(teamDataAssistantChats.eveFollowUpDeliveryState, 'ambiguous'),
      )))
      .returning({id: teamDataAssistantChats.id})
    if (!restored) throw new Error('The exact follow-up delivery changed while restoring it')
    return true
  })
}

export async function releaseDefinitiveChatFollowUpRejection(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  turnStartedAt: Date
  admissionId: string
  preTurnCursor: number
  claimedResponses?: readonly ChatApprovalResponse[]
  allowUnclaimedResponses?: boolean
  now?: Date
}) {
  return db.transaction(async transaction => {
    const claimedResponses = input.claimedResponses ?? []
    if (new Set(claimedResponses.map(response => response.requestId)).size !== claimedResponses.length) return false

    const [current] = await transaction
      .select({id: teamDataAssistantChats.id})
      .from(teamDataAssistantChats)
      .where(currentFollowUpLeaseCondition(input))
      .for('update')
      .limit(1)
    if (!current) return false

    if (claimedResponses.length > 0) {
      const requestIds = claimedResponses.map(response => response.requestId)
      const rows = await transaction
        .select({
          requestId: teamDataAssistantChatApprovals.requestId,
          resolutionStatus: teamDataAssistantChatApprovals.resolutionStatus,
          claimedByAdmissionId: teamDataAssistantChatApprovals.eveClaimedByAdmissionId,
        })
        .from(teamDataAssistantChatApprovals)
        .where(and(
          exactApprovalSessionCondition(input),
          inArray(teamDataAssistantChatApprovals.requestId, requestIds),
        ))
        .for('update')
      const rowsByRequestId = new Map(rows.map(row => [row.requestId, row]))
      if (rows.length !== claimedResponses.length || claimedResponses.some(response => {
        const status = rowsByRequestId.get(response.requestId)?.resolutionStatus
        const claimedBy = rowsByRequestId.get(response.requestId)?.claimedByAdmissionId
        return !(status === approvalResolution(response.optionId) && claimedBy === input.admissionId) &&
          !(input.allowUnclaimedResponses === true && status === 'pending' && claimedBy === null)
      })) return false

      const actuallyClaimed = claimedResponses.filter(response => {
        const row = rowsByRequestId.get(response.requestId)
        return row?.resolutionStatus === approvalResolution(response.optionId) &&
          row.claimedByAdmissionId === input.admissionId
      })
      const [approvedRequestIds, deniedRequestIds] = partitionApprovalRequestIds(actuallyClaimed)
      await restoreClaimedApprovalGroup(transaction, input, approvedRequestIds, 'approved')
      await restoreClaimedApprovalGroup(transaction, input, deniedRequestIds, 'denied')
    }

    const [released] = await transaction
      .update(teamDataAssistantChats)
      .set({
        eveSessionState: 'waiting',
        eveTurnStartedAt: null,
        eveAdmissionId: null,
        eveFollowUpDeliveryState: 'none',
        eveFollowUpPreTurnCursor: null,
        updatedAt: input.now ?? new Date(),
      })
      .where(currentFollowUpLeaseCondition(input))
      .returning({id: teamDataAssistantChats.id})
    if (!released) throw new Error('The exact follow-up lease changed while releasing it')
    return true
  })
}

export type PersistChatRuntimeEventResult = {
  status: 'inserted' | 'duplicate'
  event: Record<string, unknown>
} | {
  status: 'stale'
}

type UnsafePersistChatRuntimeEventInput = {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  streamIndex: number
  expectedCurrentCursor?: number
  onContiguousBatchCommitted?: (batch: {fromCursor: number; toCursor: number}) => void | Promise<void>
  event: {
    id: string
    type: string
    event: Record<string, unknown>
    occurredAt: Date
    createdAt: Date
  }
}

export async function persistChatRuntimeEvent(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  streamIndex: number
  sanitized: SanitizedChatEvent
  eventId?: string
  createdAt?: Date
  expectedCurrentCursor?: number
}): Promise<PersistChatRuntimeEventResult> {
  const createdAt = input.createdAt ?? new Date()
  const meta = record(input.sanitized.event.meta)
  const occurredAt = typeof meta?.at === 'string' ? new Date(meta.at) : createdAt
  return persistChatRuntimeEventRecord({
    chatId: input.chatId,
    eveSessionId: input.eveSessionId,
    sessionOrdinal: input.sessionOrdinal,
    streamIndex: input.streamIndex,
    expectedCurrentCursor: input.expectedCurrentCursor,
    event: {
      id: input.eventId ?? crypto.randomUUID(),
      type: String(input.sanitized.event.type),
      event: input.sanitized.event,
      occurredAt,
      createdAt,
    },
  })
}

declare const unsafePersistChatRuntimeEventBrand: unique symbol
export type UnsafePersistChatRuntimeEventInputForTest = UnsafePersistChatRuntimeEventInput & {
  readonly [unsafePersistChatRuntimeEventBrand]: true
}

/** @internal Raw persistence access exists only for behavior tests and requires an explicit unsafe cast. */
export async function unsafePersistChatRuntimeEventForTest(input: UnsafePersistChatRuntimeEventInputForTest) {
  return persistChatRuntimeEventRecord(input)
}

async function persistChatRuntimeEventRecord(input: UnsafePersistChatRuntimeEventInput): Promise<PersistChatRuntimeEventResult> {
  if (input.event.event.type !== input.event.type) return {status: 'stale'}

  const first = await db.transaction(async transaction => {
    const [mapping] = await transaction
      .select({cursor: teamDataAssistantChats.eveNextStreamIndex})
      .from(teamDataAssistantChats)
      .where(currentSessionCondition(input))
      .for('update')
      .limit(1)
    if (!mapping || (input.expectedCurrentCursor !== undefined && mapping.cursor !== input.expectedCurrentCursor)) {
      return {status: 'stale'} as const
    }

    const [inserted] = await transaction
      .insert(teamDataAssistantChatEvents)
      .values({
        ...input.event,
        chatId: input.chatId,
        eveSessionId: input.eveSessionId,
        sessionOrdinal: input.sessionOrdinal,
        streamIndex: input.streamIndex,
      })
      .onConflictDoNothing()
      .returning({id: teamDataAssistantChatEvents.id})
    const [stored] = await transaction
      .select({event: teamDataAssistantChatEvents.event})
      .from(teamDataAssistantChatEvents)
      .where(and(
        eq(teamDataAssistantChatEvents.chatId, input.chatId),
        eq(teamDataAssistantChatEvents.eveSessionId, input.eveSessionId),
        eq(teamDataAssistantChatEvents.sessionOrdinal, input.sessionOrdinal),
        eq(teamDataAssistantChatEvents.streamIndex, input.streamIndex),
      ))
      .limit(1)
    if (!stored) throw new Error('Chat event identity conflicted with another persisted event')

    const batch = await advanceContiguousChatEventBatchInTransaction(transaction, input, mapping.cursor)
    if (batch.status === 'stale') return {status: 'stale'} as const
    return {
      persisted: {status: inserted ? 'inserted' : 'duplicate', event: stored.event} as const,
      batch,
    }
  })
  if (first.status === 'stale') return first

  let batch: Awaited<ReturnType<typeof advanceContiguousChatEventBatch>> = first.batch
  while (true) {
    if (batch.status === 'stale') return {status: 'stale'}
    if (batch.advanced > 0) {
      await input.onContiguousBatchCommitted?.({fromCursor: batch.fromCursor, toCursor: batch.toCursor})
    }
    if (batch.advanced < CONTIGUOUS_EVENT_BATCH_SIZE) break
    batch = await advanceContiguousChatEventBatch(input)
  }
  return first.persisted
}

async function advanceContiguousChatEventBatch(input: UnsafePersistChatRuntimeEventInput) {
  return db.transaction(async transaction => {
    const [mapping] = await transaction
      .select({cursor: teamDataAssistantChats.eveNextStreamIndex})
      .from(teamDataAssistantChats)
      .where(currentSessionCondition(input))
      .for('update')
      .limit(1)
    if (!mapping) return {status: 'stale'} as const
    return advanceContiguousChatEventBatchInTransaction(transaction, input, mapping.cursor)
  })
}

async function advanceContiguousChatEventBatchInTransaction(
  transaction: ChatRuntimeTransaction,
  input: UnsafePersistChatRuntimeEventInput,
  cursor: number,
) {
  const rows = await transaction
    .select({
      streamIndex: teamDataAssistantChatEvents.streamIndex,
      type: teamDataAssistantChatEvents.type,
      event: teamDataAssistantChatEvents.event,
      createdAt: teamDataAssistantChatEvents.createdAt,
    })
    .from(teamDataAssistantChatEvents)
    .where(and(
      eq(teamDataAssistantChatEvents.chatId, input.chatId),
      eq(teamDataAssistantChatEvents.eveSessionId, input.eveSessionId),
      eq(teamDataAssistantChatEvents.sessionOrdinal, input.sessionOrdinal),
      gte(teamDataAssistantChatEvents.streamIndex, cursor),
    ))
    .orderBy(asc(teamDataAssistantChatEvents.streamIndex))
    .limit(CONTIGUOUS_EVENT_BATCH_SIZE)

  let nextCursor = cursor
  let boundaryState: ChatBoundaryState | undefined
  for (const row of rows) {
    if (row.streamIndex !== nextCursor) break
    await projectApprovalsFromEvent(transaction, {
      chatId: input.chatId,
      eveSessionId: input.eveSessionId,
      sessionOrdinal: input.sessionOrdinal,
      event: {createdAt: row.createdAt},
    }, row.event)
    nextCursor += 1
    boundaryState = boundaryStateForEventType(row.type) ?? boundaryState
  }
  const advanced = nextCursor - cursor
  if (advanced > 0) {
    const [updated] = await transaction
      .update(teamDataAssistantChats)
      .set({
        eveNextStreamIndex: nextCursor,
        ...(boundaryState ? {
          eveSessionState: boundaryState,
          eveTurnStartedAt: null,
          eveAdmissionId: null,
          eveFollowUpDeliveryState: 'none',
          eveFollowUpPreTurnCursor: null,
        } : {}),
        updatedAt: input.event.createdAt,
      })
      .where(currentSessionCondition(input, eq(teamDataAssistantChats.eveNextStreamIndex, cursor)))
      .returning({id: teamDataAssistantChats.id})
    if (!updated) return {status: 'stale'} as const

    if (boundaryState === 'completed' || boundaryState === 'failed') {
      await transaction
        .update(teamDataAssistantChatApprovals)
        .set({
          resolutionStatus: 'expired',
          eveClaimedByAdmissionId: null,
          updatedAt: input.event.createdAt,
        })
        .where(and(
          exactApprovalSessionCondition(input),
          or(
            eq(teamDataAssistantChatApprovals.resolutionStatus, 'pending'),
            and(
              inArray(teamDataAssistantChatApprovals.resolutionStatus, ['approved', 'denied']),
              isNotNull(teamDataAssistantChatApprovals.eveClaimedByAdmissionId),
            ),
          ),
        ))
    }
  }
  return {
    status: 'current',
    advanced,
    fromCursor: cursor,
    toCursor: nextCursor,
  } as const
}

export type PendingChatApproval = {
  requestId: string
  callId: string
  toolName: string
  projectionStatus: 'ready' | 'blocked'
  resolutionStatus: 'pending'
}

export async function listPendingChatApprovals(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
}): Promise<PendingChatApproval[]> {
  const rows = await db
    .select({
      requestId: teamDataAssistantChatApprovals.requestId,
      callId: teamDataAssistantChatApprovals.callId,
      toolName: teamDataAssistantChatApprovals.toolName,
      projectionStatus: teamDataAssistantChatApprovals.projectionStatus,
      resolutionStatus: teamDataAssistantChatApprovals.resolutionStatus,
    })
    .from(teamDataAssistantChatApprovals)
    .innerJoin(
      teamDataAssistantChats,
      and(
        eq(teamDataAssistantChats.id, teamDataAssistantChatApprovals.chatId),
        currentSessionCondition(input),
      ),
    )
    .where(and(
      eq(teamDataAssistantChatApprovals.chatId, input.chatId),
      eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
      eq(teamDataAssistantChatApprovals.sessionOrdinal, input.sessionOrdinal),
      eq(teamDataAssistantChatApprovals.resolutionStatus, 'pending'),
    ))
    .orderBy(asc(teamDataAssistantChatApprovals.requestId))

  return rows.flatMap(row =>
    (row.projectionStatus === 'ready' || row.projectionStatus === 'blocked') && row.resolutionStatus === 'pending'
      ? [{...row, projectionStatus: row.projectionStatus, resolutionStatus: row.resolutionStatus}]
      : [],
  )
}

export type ChatApprovalClaimResult = {status: 'claimed'} | {status: 'rejected'}

export async function claimChatApprovalResponses(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  turnStartedAt: Date
  admissionId: string
  preTurnCursor: number
  responses: readonly ChatApprovalResponse[]
  now?: Date
}): Promise<ChatApprovalClaimResult> {
  return db.transaction(async transaction => {
    if (
      input.responses.length === 0 ||
      new Set(input.responses.map(response => response.requestId)).size !== input.responses.length
    ) return {status: 'rejected'} as const

    const [current] = await transaction
      .select({id: teamDataAssistantChats.id})
      .from(teamDataAssistantChats)
      .where(currentFollowUpLeaseCondition(input))
      .for('update')
      .limit(1)
    if (!current) return {status: 'rejected'} as const

    const requestIds = input.responses.map(response => response.requestId)
    const rows = await transaction
      .select({
        requestId: teamDataAssistantChatApprovals.requestId,
        projectionStatus: teamDataAssistantChatApprovals.projectionStatus,
        resolutionStatus: teamDataAssistantChatApprovals.resolutionStatus,
      })
      .from(teamDataAssistantChatApprovals)
      .where(and(
        exactApprovalSessionCondition(input),
        inArray(teamDataAssistantChatApprovals.requestId, requestIds),
      ))
      .for('update')
    const rowsByRequestId = new Map(rows.map(row => [row.requestId, row]))
    if (
      rows.length !== input.responses.length ||
      input.responses.some(response => {
        const row = rowsByRequestId.get(response.requestId)
        return !row || row.resolutionStatus !== 'pending' ||
          (response.optionId === 'approve' && row.projectionStatus !== 'ready')
      })
    ) return {status: 'rejected'} as const

    const [approvedRequestIds, deniedRequestIds] = partitionApprovalRequestIds(input.responses)
    await claimApprovalGroup(transaction, input, approvedRequestIds, 'approved')
    await claimApprovalGroup(transaction, input, deniedRequestIds, 'denied')
    return {status: 'claimed'} as const
  })
}

// Eve 0.22.1 has no durable input-response stream event. This single-request seam remains for
// event lifecycle tests; browser turns claim their complete response set atomically above.
export type ChatApprovalResolutionResult =
  | {status: 'transitioned'}
  | {status: 'already-resolved'}
  | {status: 'not-found-or-blocked'}

export async function markChatApprovalResolution(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  requestId: string
  resolution: 'approved' | 'denied'
  now?: Date
}): Promise<ChatApprovalResolutionResult> {
  return db.transaction(async transaction => {
    const [current] = await transaction
      .select({id: teamDataAssistantChats.id})
      .from(teamDataAssistantChats)
      .where(currentSessionCondition(input))
      .for('update')
      .limit(1)
    if (!current) return {status: 'not-found-or-blocked'} as const

    const [updated] = await transaction
      .update(teamDataAssistantChatApprovals)
      .set({resolutionStatus: input.resolution, eveClaimedByAdmissionId: null, updatedAt: input.now ?? new Date()})
      .where(and(
        eq(teamDataAssistantChatApprovals.chatId, input.chatId),
        eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
        eq(teamDataAssistantChatApprovals.sessionOrdinal, input.sessionOrdinal),
        eq(teamDataAssistantChatApprovals.requestId, input.requestId),
        eq(teamDataAssistantChatApprovals.resolutionStatus, 'pending'),
        input.resolution === 'approved'
          ? eq(teamDataAssistantChatApprovals.projectionStatus, 'ready')
          : undefined,
      ))
      .returning({id: teamDataAssistantChatApprovals.id})
    if (updated) return {status: 'transitioned'} as const

    const [existing] = await transaction
      .select({
        projectionStatus: teamDataAssistantChatApprovals.projectionStatus,
        resolutionStatus: teamDataAssistantChatApprovals.resolutionStatus,
      })
      .from(teamDataAssistantChatApprovals)
      .where(and(
        eq(teamDataAssistantChatApprovals.chatId, input.chatId),
        eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
        eq(teamDataAssistantChatApprovals.sessionOrdinal, input.sessionOrdinal),
        eq(teamDataAssistantChatApprovals.requestId, input.requestId),
      ))
      .limit(1)
    return existing?.resolutionStatus === input.resolution &&
      (input.resolution === 'denied' || existing.projectionStatus === 'ready')
      ? {status: 'already-resolved'} as const
      : {status: 'not-found-or-blocked'} as const
  })
}

async function projectApprovalsFromEvent(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {chatId: string; eveSessionId: string; sessionOrdinal: number; event: {createdAt: Date}},
  event: Record<string, unknown>,
) {
  const data = record(event.data)
  if (event.type === 'input.requested' && Array.isArray(data?.requests)) {
    for (const value of data.requests) {
      const request = record(value)
      const action = record(request?.action)
      if (!request || !action || typeof request.requestId !== 'string' || typeof action.callId !== 'string' || typeof action.toolName !== 'string') continue
      const parsedProposal = safeChatProposalSchema.safeParse(action.input)
      const projectionStatus = parsedProposal.success ? 'ready' : 'blocked'
      const safeProposal = parsedProposal.success ? parsedProposal.data : null
      const [inserted] = await transaction
        .insert(teamDataAssistantChatApprovals)
        .values({
          id: crypto.randomUUID(),
          chatId: input.chatId,
          eveSessionId: input.eveSessionId,
          sessionOrdinal: input.sessionOrdinal,
          requestId: request.requestId,
          callId: action.callId,
          toolName: action.toolName,
          safeProposal,
          projectionStatus,
          resolutionStatus: 'pending',
          createdAt: input.event.createdAt,
          updatedAt: input.event.createdAt,
        })
        .onConflictDoNothing()
        .returning({id: teamDataAssistantChatApprovals.id})
      if (inserted) continue

      const [existing] = await transaction
        .select({
          callId: teamDataAssistantChatApprovals.callId,
          toolName: teamDataAssistantChatApprovals.toolName,
          safeProposal: teamDataAssistantChatApprovals.safeProposal,
          projectionStatus: teamDataAssistantChatApprovals.projectionStatus,
        })
        .from(teamDataAssistantChatApprovals)
        .where(and(
          eq(teamDataAssistantChatApprovals.chatId, input.chatId),
          eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
          eq(teamDataAssistantChatApprovals.requestId, request.requestId),
        ))
        .limit(1)
      if (
        !existing ||
        existing.callId !== action.callId ||
        existing.toolName !== action.toolName ||
        existing.projectionStatus !== projectionStatus ||
        !sameSafeProposal(existing.safeProposal, safeProposal)
      ) {
        throw new Error('Approval request identity was reused with different safe data')
      }
    }
    return
  }

  if (event.type !== 'action.result') return
  const result = record(data?.result)
  if (!data || !result || typeof result.callId !== 'string' || typeof result.toolName !== 'string') return
  const targetStatus = data.status === 'rejected'
    ? 'denied'
    : data.status === 'completed' || data.status === 'failed'
      ? 'completed'
      : null
  if (!targetStatus) return
  const mutableStatuses = targetStatus === 'denied' ? ['pending', 'approved'] : ['pending', 'approved', 'completed']
  await transaction
    .update(teamDataAssistantChatApprovals)
    .set({resolutionStatus: targetStatus, eveClaimedByAdmissionId: null, updatedAt: input.event.createdAt})
    .where(and(
      eq(teamDataAssistantChatApprovals.chatId, input.chatId),
      eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
      eq(teamDataAssistantChatApprovals.sessionOrdinal, input.sessionOrdinal),
      eq(teamDataAssistantChatApprovals.callId, result.callId),
      eq(teamDataAssistantChatApprovals.toolName, result.toolName),
      inArray(teamDataAssistantChatApprovals.resolutionStatus, mutableStatuses),
    ))
}

function sameSafeProposal(left: unknown, right: unknown) {
  if (left === null || right === null) return left === right
  const parsedLeft = safeChatProposalSchema.safeParse(left)
  const parsedRight = safeChatProposalSchema.safeParse(right)
  return parsedLeft.success && parsedRight.success &&
    JSON.stringify(parsedLeft.data) === JSON.stringify(parsedRight.data)
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export async function reapStaleChatAdmissions(input: {now?: Date} = {}) {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - CHAT_STALE_ADMISSION_CUTOFF_MS)
  return db.transaction(async transaction => {
    const stale = await transaction
      .select({
        chatId: teamDataAssistantChats.id,
        sessionOrdinal: teamDataAssistantChats.eveSessionOrdinal,
        admissionId: teamDataAssistantChats.eveAdmissionId,
      })
      .from(teamDataAssistantChats)
      .where(and(
        eq(teamDataAssistantChats.eveSessionState, 'admitting'),
        isNull(teamDataAssistantChats.eveSessionId),
        lte(teamDataAssistantChats.eveTurnStartedAt, cutoff),
      ))
      .limit(STALE_ADMISSION_REAP_BATCH_SIZE)
      .for('update', {skipLocked: true})
    if (stale.length === 0) return []

    await transaction
      .update(teamDataAssistantChats)
      .set({eveSessionState: 'failed', eveTurnStartedAt: null, eveAdmissionId: null, updatedAt: now})
      .where(inArray(teamDataAssistantChats.id, stale.map(row => row.chatId)))
    return stale
  })
}

export async function persistMissingChatSessionFailure(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  streamIndex: number
  now?: Date
}) {
  const result = await persistChatRuntimeEvent({
    chatId: input.chatId,
    eveSessionId: input.eveSessionId,
    sessionOrdinal: input.sessionOrdinal,
    streamIndex: input.streamIndex,
    sanitized: createMissingChatSessionFailureEvent(),
    createdAt: input.now ?? new Date(),
    expectedCurrentCursor: input.streamIndex,
  })
  return result.status !== 'stale'
}

export async function markCurrentChatSessionFailed(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  now?: Date
}) {
  return updateCurrentSessionState({...input, state: 'failed'})
}

export async function markCurrentChatSessionTerminal(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  state: Extract<ChatBoundaryState, 'completed' | 'failed'>
  now?: Date
}) {
  return updateCurrentSessionState(input)
}

async function updateCurrentSessionState(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  state: Extract<ChatBoundaryState, 'completed' | 'failed'>
  now?: Date
}) {
  const [updated] = await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionState: input.state,
      eveTurnStartedAt: null,
      eveAdmissionId: null,
      eveFollowUpDeliveryState: 'none',
      eveFollowUpPreTurnCursor: null,
      updatedAt: input.now ?? new Date(),
    })
    .where(currentSessionCondition(input))
    .returning({id: teamDataAssistantChats.id})
  return Boolean(updated)
}

type ChatRuntimeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function partitionApprovalRequestIds(responses: readonly ChatApprovalResponse[]) {
  return [
    responses.filter(response => response.optionId === 'approve').map(response => response.requestId),
    responses.filter(response => response.optionId === 'deny').map(response => response.requestId),
  ] as const
}

async function claimApprovalGroup(
  transaction: ChatRuntimeTransaction,
  input: {chatId: string; eveSessionId: string; sessionOrdinal: number; admissionId: string; now?: Date},
  requestIds: string[],
  resolutionStatus: 'approved' | 'denied',
) {
  if (requestIds.length === 0) return
  const claimed = await transaction
    .update(teamDataAssistantChatApprovals)
    .set({
      resolutionStatus,
      eveClaimedByAdmissionId: input.admissionId,
      updatedAt: input.now ?? new Date(),
    })
    .where(and(
      exactApprovalSessionCondition(input),
      inArray(teamDataAssistantChatApprovals.requestId, requestIds),
      eq(teamDataAssistantChatApprovals.resolutionStatus, 'pending'),
      resolutionStatus === 'approved'
        ? eq(teamDataAssistantChatApprovals.projectionStatus, 'ready')
        : undefined,
    ))
    .returning({requestId: teamDataAssistantChatApprovals.requestId})
  if (claimed.length !== requestIds.length) throw new Error('Approval claim set changed during its transaction')
}

async function restoreClaimedApprovalGroup(
  transaction: ChatRuntimeTransaction,
  input: {chatId: string; eveSessionId: string; sessionOrdinal: number; admissionId: string; now?: Date},
  requestIds: string[],
  claimedStatus: 'approved' | 'denied',
) {
  if (requestIds.length === 0) return
  const restored = await transaction
    .update(teamDataAssistantChatApprovals)
    .set({resolutionStatus: 'pending', eveClaimedByAdmissionId: null, updatedAt: input.now ?? new Date()})
    .where(and(
      exactApprovalSessionCondition(input),
      inArray(teamDataAssistantChatApprovals.requestId, requestIds),
      eq(teamDataAssistantChatApprovals.resolutionStatus, claimedStatus),
      eq(teamDataAssistantChatApprovals.eveClaimedByAdmissionId, input.admissionId),
    ))
    .returning({requestId: teamDataAssistantChatApprovals.requestId})
  if (restored.length !== requestIds.length) throw new Error('Approval restoration set changed during its transaction')
}

function approvalResolution(optionId: ChatApprovalResponse['optionId']) {
  return optionId === 'approve' ? 'approved' : 'denied'
}

function exactApprovalSessionCondition(input: {chatId: string; eveSessionId: string; sessionOrdinal: number}) {
  return and(
    eq(teamDataAssistantChatApprovals.chatId, input.chatId),
    eq(teamDataAssistantChatApprovals.eveSessionId, input.eveSessionId),
    eq(teamDataAssistantChatApprovals.sessionOrdinal, input.sessionOrdinal),
  )!
}

function currentFollowUpLeaseCondition(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  turnStartedAt: Date
  admissionId: string
  preTurnCursor: number
}, extraCondition?: SQL) {
  return currentFollowUpDeliveryCondition(input, and(
    eq(teamDataAssistantChats.eveTurnStartedAt, input.turnStartedAt),
    extraCondition,
  ))
}

function currentFollowUpDeliveryCondition(input: {
  chatId: string
  eveSessionId: string
  sessionOrdinal: number
  admissionId: string
  preTurnCursor: number
}, extraCondition?: SQL) {
  return currentSessionCondition(input, and(
    eq(teamDataAssistantChats.eveSessionState, 'running'),
    eq(teamDataAssistantChats.eveAdmissionId, input.admissionId),
    eq(teamDataAssistantChats.eveFollowUpPreTurnCursor, input.preTurnCursor),
    extraCondition,
  ))
}

function boundaryStateForEventType(type: string): ChatBoundaryState | undefined {
  if (type === 'session.waiting') return 'waiting'
  if (type === 'session.completed') return 'completed'
  if (type === 'session.failed') return 'failed'
  return undefined
}

function normalizeRuntimeMapping<T extends {sessionState: string; followUpDeliveryState: string}>(mapping: T) {
  return {
    ...mapping,
    sessionState: mapping.sessionState as ChatSessionState,
    followUpDeliveryState: mapping.followUpDeliveryState as ChatFollowUpDeliveryState,
  }
}

function currentSessionCondition(
  input: {chatId: string; eveSessionId: string; sessionOrdinal: number},
  extraCondition?: SQL,
) {
  return and(
    eq(teamDataAssistantChats.id, input.chatId),
    eq(teamDataAssistantChats.eveSessionId, input.eveSessionId),
    eq(teamDataAssistantChats.eveSessionOrdinal, input.sessionOrdinal),
    extraCondition,
  )!
}
