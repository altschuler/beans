import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {asc, eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {
  attachChatSessionStart,
  markChatApprovalResolution,
  persistChatRuntimeEvent,
  reserveChatSessionStart,
  unsafePersistChatRuntimeEventForTest,
  type UnsafePersistChatRuntimeEventInputForTest,
} from '@/eve/chat-runtime-repository.server'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {
  teamDataAssistantChatApprovals,
  teamDataAssistantChatEvents,
  teamDataAssistantChats,
  teamMembers,
  teams,
  user,
} from '@penge/domain/schema'

const now = new Date('2026-07-10T12:00:00.000Z')

beforeAll(() => migrateDatabase())
beforeEach(async () => {
  await resetDatabase()
  await seedAttachedChat()
})
afterAll(() => closeDatabase())

describe('atomic Eve chat event ingestion', () => {
  it('idempotently persists duplicates and advances only a contiguous cursor through gap fill without rollback', async () => {
    expect((await persist(1, {type: 'session.waiting', data: {wait: 'next-user-message'}})).status).toBe('inserted')
    let [chat] = await db.select().from(teamDataAssistantChats)
    expect(chat).toMatchObject({eveNextStreamIndex: 0, eveSessionState: 'running'})

    expect((await persist(0, {type: 'session.started', data: {}})).status).toBe('inserted')
    ;[chat] = await db.select().from(teamDataAssistantChats)
    expect(chat).toMatchObject({eveNextStreamIndex: 2, eveSessionState: 'waiting'})

    const duplicate = await persist(0, {type: 'future.different', data: {raw: 'must-not-replace'}})
    expect(duplicate).toMatchObject({status: 'duplicate', event: {type: 'session.started', data: {}}})
    ;[chat] = await db.select().from(teamDataAssistantChats)
    expect(chat).toMatchObject({eveNextStreamIndex: 2, eveSessionState: 'waiting'})
    expect(await db.select().from(teamDataAssistantChatEvents)).toHaveLength(2)
  })

  it('atomically creates a pending approval and applies exact proxy/durable lifecycle transitions', async () => {
    const requestEvent = {
      type: 'input.requested',
      data: {
        sequence: 1, stepIndex: 0, turnId: 'turn-1',
        requests: [{
          requestId: 'request-1', prompt: 'Approve this change?', display: 'confirmation', allowFreeform: false,
          options: [{id: 'approve', label: 'Approve'}, {id: 'deny', label: 'Deny'}],
          action: {
            kind: 'tool-call', callId: 'call-1', toolName: 'manageCategory',
            input: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Home'}},
          },
        }],
      },
    }
    await persist(0, requestEvent)
    expect(await approvals()).toEqual([expect.objectContaining({
      requestId: 'request-1', callId: 'call-1', projectionStatus: 'ready', resolutionStatus: 'pending',
      safeProposal: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Home'}},
    })])

    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'approved', now,
    })).toEqual({status: 'transitioned'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'approved', now,
    })).toEqual({status: 'already-resolved'})
    expect((await approvals())[0]).toMatchObject({resolutionStatus: 'approved'})

    await persist(1, {
      type: 'action.result',
      data: {sequence: 2, stepIndex: 0, turnId: 'turn-1', status: 'completed', result: {kind: 'tool-result', callId: 'call-1', toolName: 'manageCategory', output: {redacted: true}}},
    })
    expect((await approvals())[0]).toMatchObject({resolutionStatus: 'completed'})

    await persist(2, {type: 'session.completed'})
    expect((await approvals())[0]).toMatchObject({resolutionStatus: 'completed'})
  })

  it.each(['completed', 'failed'] as const)('expires unresolved approvals atomically at a terminal %s boundary', async sessionState => {
    await db.insert(teamDataAssistantChatApprovals).values([
      {
        id: 'approval-pending', chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        requestId: 'request-pending', callId: 'call-pending', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'blocked', resolutionStatus: 'pending', createdAt: now, updatedAt: now,
      },
      {
        id: 'approval-claimed', chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        requestId: 'request-claimed', callId: 'call-claimed', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'ready', resolutionStatus: 'approved', eveClaimedByAdmissionId: 'admission-1',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'approval-denied', chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        requestId: 'request-denied', callId: 'call-denied', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'blocked', resolutionStatus: 'denied', createdAt: now, updatedAt: now,
      },
      {
        id: 'approval-completed', chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        requestId: 'request-completed', callId: 'call-completed', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'ready', resolutionStatus: 'completed', createdAt: now, updatedAt: now,
      },
      {
        id: 'approval-old', chatId: 'chat-1', eveSessionId: 'old-session', sessionOrdinal: 0,
        requestId: 'request-old', callId: 'call-old', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'blocked', resolutionStatus: 'pending', createdAt: now, updatedAt: now,
      },
    ])

    await persist(0, {type: `session.${sessionState}`})

    expect((await approvals()).map(row => [row.id, row.resolutionStatus, row.eveClaimedByAdmissionId])).toEqual([
      ['approval-claimed', 'expired', null],
      ['approval-completed', 'completed', null],
      ['approval-denied', 'denied', null],
      ['approval-old', 'pending', null],
      ['approval-pending', 'expired', null],
    ])
  })

  it('maps a rejected matching action result to denied and keeps unresolved approvals at a waiting boundary', async () => {
    for (const [index, requestId, callId] of [[0, 'request-1', 'call-1'], [1, 'request-2', 'call-2']] as const) {
      await persist(index, {
        type: 'input.requested',
        data: {sequence: index, stepIndex: 0, turnId: 'turn-1', requests: [{
          requestId, prompt: 'Approve this change?', display: 'confirmation',
          options: [{id: 'approve', label: 'Approve'}, {id: 'deny', label: 'Deny'}],
          action: {kind: 'tool-call', callId, toolName: 'manageCategory', input: {}},
        }]},
      })
    }
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'wrong-session', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'denied', now,
    })).toEqual({status: 'not-found-or-blocked'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'approved', now,
    })).toEqual({status: 'not-found-or-blocked'})
    expect((await approvals())[0]).toMatchObject({projectionStatus: 'blocked', resolutionStatus: 'pending'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'denied', now,
    })).toEqual({status: 'transitioned'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-1', resolution: 'denied', now,
    })).toEqual({status: 'already-resolved'})

    await persist(2, {
      type: 'action.result',
      data: {
        sequence: 2, stepIndex: 0, turnId: 'turn-1', status: 'rejected',
        error: {code: 'TOOL_EXECUTION_DENIED', message: 'This change was denied.'},
        result: {kind: 'tool-result', callId: 'call-1', toolName: 'manageCategory', output: {redacted: true}},
      },
    })
    await persist(3, {type: 'session.waiting', data: {wait: 'next-user-message'}})
    expect((await approvals()).map(row => [row.requestId, row.resolutionStatus])).toEqual([
      ['request-1', 'denied'], ['request-2', 'pending'],
    ])
  })

  it('accepts identical approval identity replay but rolls back conflicting request identity or proposal reuse', async () => {
    const request = {
      requestId: 'immutable-request', prompt: 'Approve this change?', display: 'confirmation',
      options: [{id: 'approve', label: 'Approve'}, {id: 'deny', label: 'Deny'}],
      action: {
        kind: 'tool-call', callId: 'immutable-call', toolName: 'manageCategory',
        input: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Original'}},
      },
    }
    await persist(0, {type: 'input.requested', data: {...eventStructure(0), requests: [request]}})
    await expect(persist(1, {type: 'input.requested', data: {...eventStructure(1), requests: [request]}})).resolves.toMatchObject({status: 'inserted'})
    expect(await approvals()).toEqual([expect.objectContaining({
      requestId: 'immutable-request', callId: 'immutable-call', toolName: 'manageCategory',
      projectionStatus: 'ready', safeProposal: request.action.input,
    })])

    const conflicts = [
      {...request, action: {...request.action, callId: 'changed-call'}},
      {...request, action: {...request.action, toolName: 'applyCategorizations'}},
      {...request, action: {...request.action, input: {}}},
      {...request, action: {...request.action, input: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Changed'}}}},
    ]
    for (const conflictingRequest of conflicts) {
      await expect(persist(2, {type: 'input.requested', data: {...eventStructure(2), requests: [conflictingRequest]}}))
        .rejects.toThrow('Approval request identity was reused with different safe data')
      expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({eveNextStreamIndex: 2})
      expect(await db.select().from(teamDataAssistantChatEvents).where(eq(teamDataAssistantChatEvents.streamIndex, 2))).toHaveLength(0)
    }
  })

  it('converges a contiguous run through separate bounded committed batches', async () => {
    const eventCount = 300
    const committedBatchCursors: number[] = []
    await db.insert(teamDataAssistantChatEvents).values(Array.from({length: eventCount}, (_, offset) => {
      const streamIndex = offset + 1
      const event = streamIndex === eventCount
        ? {type: 'session.waiting', data: {wait: 'next-user-message'}}
        : {type: 'session.started', data: {}}
      return {
        id: `prefilled-${streamIndex}`, chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        streamIndex, type: event.type, event, occurredAt: now, createdAt: new Date(now.getTime() + streamIndex),
      }
    }))

    await persist(0, {type: 'session.started', data: {}}, async () => {
      committedBatchCursors.push((await db.select().from(teamDataAssistantChats))[0]!.eveNextStreamIndex)
    })
    expect(committedBatchCursors).toEqual([128, 256, 301])
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({
      eveNextStreamIndex: eventCount + 1,
      eveSessionState: 'waiting',
    })
  })

  it.each([
    ['rejected', 'denied'],
    ['completed', 'completed'],
  ] as const)('replays every newly contiguous approval event in order when filling a gap: %s -> %s', async (status, expected) => {
    await persist(1, {
      type: 'action.result',
      data: {
        sequence: 2, stepIndex: 0, turnId: 'turn-1', status,
        result: {kind: 'tool-result', callId: 'call-gap', toolName: 'manageCategory', output: {redacted: true}},
        ...(status === 'rejected' ? {error: {code: 'TOOL_EXECUTION_DENIED', message: 'This change was denied.'}} : {}),
      },
    })
    expect(await approvals()).toHaveLength(0)
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({eveNextStreamIndex: 0})

    await persist(0, {
      type: 'input.requested',
      data: {sequence: 1, stepIndex: 0, turnId: 'turn-1', requests: [{
        requestId: 'request-gap', prompt: 'Approve this change?', display: 'confirmation',
        options: [{id: 'approve', label: 'Approve'}, {id: 'deny', label: 'Deny'}],
        action: {
          kind: 'tool-call', callId: 'call-gap', toolName: 'manageCategory',
          input: {kind: 'manageCategory', operation: {kind: 'createGroup', newName: 'Gap-safe'}},
        },
      }]},
    })

    expect(await approvals()).toEqual([expect.objectContaining({
      requestId: 'request-gap', projectionStatus: 'ready', resolutionStatus: expected,
    })])
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({eveNextStreamIndex: 2})
  })

  it('conditions every event, cursor, state, and approval write on the current session ordinal', async () => {
    await db.update(teamDataAssistantChats).set({eveSessionId: 'replacement', eveSessionOrdinal: 2, eveNextStreamIndex: 4, eveSessionState: 'running'})
      .where(eq(teamDataAssistantChats.id, 'chat-1'))
    const stale = await persist(0, {
      type: 'input.requested', data: {sequence: 1, stepIndex: 0, turnId: 'turn', requests: []},
    })
    expect(stale.status).toBe('stale')
    expect(await db.select().from(teamDataAssistantChatEvents)).toHaveLength(0)
    expect(await approvals()).toHaveLength(0)
    const [chat] = await db.select().from(teamDataAssistantChats)
    expect(chat).toMatchObject({eveSessionId: 'replacement', eveSessionOrdinal: 2, eveNextStreamIndex: 4, eveSessionState: 'running'})
  })
})

async function persist(
  streamIndex: number,
  event: Record<string, unknown>,
  onContiguousBatchCommitted?: () => void | Promise<void>,
) {
  return unsafePersistChatRuntimeEventForTest({
    chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1, streamIndex,
    event: {
      id: `event-${streamIndex}`, type: String(event.type), event,
      occurredAt: now, createdAt: new Date(now.getTime() + streamIndex),
    },
    onContiguousBatchCommitted,
  } as unknown as UnsafePersistChatRuntimeEventInputForTest)
}

function eventStructure(sequence: number) {
  return {sequence, stepIndex: 0, turnId: 'turn-1'}
}

// Production persistence accepts only the opaque sanitizer-owned envelope.
void (() => {
  // @ts-expect-error raw upstream-shaped events are intentionally rejected by the production seam
  void persistChatRuntimeEvent({chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1, streamIndex: 0, event: {}})
})

async function approvals() {
  return db.select().from(teamDataAssistantChatApprovals).orderBy(asc(teamDataAssistantChatApprovals.requestId))
}

async function seedAttachedChat() {
  await db.insert(user).values({id: 'user-1', name: 'User', email: 'user@example.com', emailVerified: true, createdAt: now, updatedAt: now})
  await db.insert(teams).values({id: 'team-1', name: 'Team', createdAt: now, updatedAt: now})
  await db.insert(teamMembers).values({id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now})
  await db.insert(teamDataAssistantChats).values({id: 'chat-1', teamId: 'team-1', userId: 'user-1', createdAt: now, updatedAt: now, lastUsedAt: now})
  const reserved = await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'admission-1', now})
  if (!reserved) throw new Error('Expected chat reservation')
  const attached = await attachChatSessionStart({
    chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'admission-1',
    eveSessionId: 'session-1', eveContinuationToken: 'token-1', now,
  })
  if (!attached) throw new Error('Expected attached chat')
}
