import {readFileSync} from 'node:fs'
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {and, asc, eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {
  attachChatSessionStart,
  claimChatApprovalResponses,
  currentChatSessionHasCommittedTerminalBoundary,
  getAuthorizedChatRuntimeMapping,
  listPendingChatApprovals,
  markChatApprovalResolution,
  markChatFollowUpDeliveryAcknowledged,
  markChatFollowUpDeliveryAmbiguous,
  markCurrentChatSessionFailed,
  markCurrentChatSessionTerminal,
  persistMissingChatSessionFailure,
  promoteStalePendingChatFollowUp,
  unsafePersistChatRuntimeEventForTest,
  type UnsafePersistChatRuntimeEventInputForTest,
  reapStaleChatAdmissions,
  releaseDefinitiveChatFollowUpRejection,
  releaseDefinitiveChatStartRejection,
  reserveChatFollowUp,
  reserveChatSessionStart,
  restoreUnadmittedChatFollowUp,
} from '@/eve/chat-runtime-repository.server'
import {CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS} from '@/eve/chat-runtime-constants'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {
  teamDataAssistantChatApprovals,
  teamDataAssistantChatEvents,
  teamDataAssistantChats,
  teamMembers,
  teams,
  user,
} from '@penge/domain/schema'

const baseTime = new Date('2026-07-10T12:00:00.000Z')

beforeAll(() => migrateDatabase())
beforeEach(async () => {
  await resetDatabase()
  await seedChat('chat-1')
})
afterAll(() => closeDatabase())

describe('eve chat runtime repository', () => {
  it('authorizes runtime mappings by chat owner and current membership', async () => {
    expect(await getAuthorizedChatRuntimeMapping({chatId: 'chat-1', userId: 'user-1'})).toMatchObject({
      chatId: 'chat-1', teamId: 'team-1', userId: 'user-1', sessionOrdinal: 0, sessionState: 'none',
    })
    expect(await getAuthorizedChatRuntimeMapping({chatId: 'chat-1', userId: 'user-2'})).toBeNull()

    await db.delete(teamMembers).where(eq(teamMembers.id, 'member-1'))
    expect(await getAuthorizedChatRuntimeMapping({chatId: 'chat-1', userId: 'user-1'})).toBeNull()
  })

  it('admits starts only when none has no mapped runtime handles', async () => {
    for (const handles of [
      {eveSessionId: 'stale-session', eveContinuationToken: null},
      {eveSessionId: null, eveContinuationToken: 'stale-token'},
    ]) {
      await db.update(teamDataAssistantChats).set({eveSessionState: 'none', ...handles})
        .where(eq(teamDataAssistantChats.id, 'chat-1'))
      expect(await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'must-not-win', now: baseTime})).toBeNull()
    }

    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({
      eveSessionState: 'none', eveSessionId: null, eveContinuationToken: 'stale-token', eveSessionOrdinal: 0,
    })
  })

  it('enforces the exact approval-resolution vocabulary in PostgreSQL', async () => {
    for (const [index, resolutionStatus] of ['pending', 'approved', 'denied', 'completed', 'expired'].entries()) {
      await expect(db.insert(teamDataAssistantChatApprovals).values({
        id: `approval-status-${index}`, chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
        requestId: `request-status-${index}`, callId: `call-status-${index}`, toolName: 'manageCategory',
        safeProposal: null, projectionStatus: 'blocked', resolutionStatus, createdAt: baseTime, updatedAt: baseTime,
      })).resolves.toBeDefined()
    }
    await expect(db.insert(teamDataAssistantChatApprovals).values({
      id: 'approval-status-invalid', chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 1,
      requestId: 'request-status-invalid', callId: 'call-status-invalid', toolName: 'manageCategory',
      safeProposal: null, projectionStatus: 'blocked', resolutionStatus: 'superseded', createdAt: baseTime, updatedAt: baseTime,
    })).rejects.toThrow()
  })

  it('enforces the exact session-state vocabulary in PostgreSQL', async () => {
    for (const state of ['none', 'admitting', 'running', 'waiting', 'completed', 'failed']) {
      await expect(db.update(teamDataAssistantChats)
        .set({eveSessionState: state})
        .where(eq(teamDataAssistantChats.id, 'chat-1'))).resolves.toBeDefined()
    }
    await expect(db.update(teamDataAssistantChats)
      .set({eveSessionState: 'idle' as never})
      .where(eq(teamDataAssistantChats.id, 'chat-1'))).rejects.toThrow()
  })

  it('admits one concurrent start and increments its ordinal exactly once', async () => {
    const attempts = await Promise.all([
      reserveChatSessionStart({chatId: 'chat-1', admissionId: 'admission-a', now: baseTime}),
      reserveChatSessionStart({chatId: 'chat-1', admissionId: 'admission-b', now: baseTime}),
    ])

    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(attempts.filter(Boolean)[0]).toMatchObject({sessionOrdinal: 1, sessionState: 'admitting'})
    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({eveSessionOrdinal: 1, eveSessionState: 'admitting', eveNextStreamIndex: 0})
  })

  it('releases only the exact definitively rejected start admission', async () => {
    const reserved = await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'admission-1', now: baseTime})
    expect(reserved).toMatchObject({sessionOrdinal: 1, sessionState: 'admitting'})
    expect(await releaseDefinitiveChatStartRejection({
      chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'wrong-admission', now: baseTime,
    })).toBe(false)
    expect(await releaseDefinitiveChatStartRejection({
      chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'admission-1', now: baseTime,
    })).toBe(true)

    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({
      eveSessionState: 'failed', eveSessionId: null, eveContinuationToken: null, eveAdmissionId: null, eveTurnStartedAt: null,
    })
    expect(await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'retry', now: baseTime})).toMatchObject({sessionOrdinal: 2})
  })

  it('does not attach stale start handles after a replacement admission', async () => {
    await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'first', now: baseTime})
    await releaseDefinitiveChatStartRejection({chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'first', now: baseTime})
    await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'replacement', now: baseTime})

    expect(await attachChatSessionStart({
      chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'first',
      eveSessionId: 'stale-session', eveContinuationToken: 'stale-token', now: baseTime,
    })).toBeNull()
    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({
      eveSessionOrdinal: 2, eveSessionState: 'admitting', eveAdmissionId: 'replacement',
      eveSessionId: null, eveContinuationToken: null,
    })
  })

  it('admits one waiting follow-up and releases only the same rejected turn lease', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})

    const attempts = await Promise.all([
      reserveChatFollowUp({chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, now: baseTime}),
      reserveChatFollowUp({chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, now: new Date(baseTime.getTime() + 1)}),
    ])
    const winner = attempts.find(Boolean)
    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(winner).toMatchObject({sessionState: 'running'})
    if (!winner?.turnStartedAt) throw new Error('Expected the winning follow-up to own a turn lease')
    const turnStartedAt = winner.turnStartedAt
    if (!winner.admissionId || winner.followUpPreTurnCursor === null) throw new Error('Expected delivery marker')
    const exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: winner.admissionId, preTurnCursor: winner.followUpPreTurnCursor,
    }

    expect(await releaseDefinitiveChatFollowUpRejection({
      ...exact,
      turnStartedAt: new Date(baseTime.getTime() + (turnStartedAt.getTime() === baseTime.getTime() ? 1 : 0)),
    })).toBe(false)
    expect(await releaseDefinitiveChatFollowUpRejection({...exact, turnStartedAt})).toBe(true)
  })

  it('derives all boundary transitions from matching persisted event types and rejects mismatches atomically', async () => {
    await startAndAttach()
    const mismatch = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, streamIndex: 0,
      event: {
        id: 'mismatched-event', type: 'message.delta', event: {type: 'session.completed'},
        occurredAt: baseTime, createdAt: baseTime,
      },
      boundaryState: 'completed',
    }
    expect(await unsafePersistChatRuntimeEventForTest(mismatch as never)).toEqual({status: 'stale'})
    let [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({eveSessionState: 'running', eveNextStreamIndex: 0})
    expect(await db.select().from(teamDataAssistantChatEvents).where(eq(teamDataAssistantChatEvents.id, 'mismatched-event'))).toHaveLength(0)

    expect(await unsafePersistChatRuntimeEventForTest({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, streamIndex: 0,
      event: {
        id: 'normal-event', type: 'message.delta', event: {type: 'message.delta'},
        occurredAt: baseTime, createdAt: baseTime,
      },
      boundaryState: 'completed',
    } as never)).toMatchObject({status: 'inserted'})
    ;[row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({eveSessionState: 'running', eveNextStreamIndex: 1})
    expect(await db.select().from(teamDataAssistantChatEvents).where(eq(teamDataAssistantChatEvents.id, 'normal-event'))).toHaveLength(1)

    for (const [streamIndex, state] of [[1, 'waiting'], [2, 'completed'], [3, 'failed']] as const) {
      expect(await persistEvent({sessionOrdinal: 1, streamIndex, type: `session.${state}`})).toMatchObject({status: 'inserted'})
      ;[row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
      expect(row).toMatchObject({eveSessionState: state, eveNextStreamIndex: streamIndex + 1})
    }
  })

  it('does not replace a running session until its terminal boundary transaction commits', async () => {
    await startAndAttach()
    expect(await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'too-early', now: baseTime})).toBeNull()
    expect(await markCurrentChatSessionTerminal({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, state: 'completed', now: baseTime,
    })).toBe(true)
    expect(await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'unreconciled', now: baseTime})).toBeNull()
    expect(await currentChatSessionHasCommittedTerminalBoundary({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, state: 'completed',
    })).toBe(false)

    await persistEvent({sessionOrdinal: 1, streamIndex: 0, type: 'session.completed'})
    expect(await currentChatSessionHasCommittedTerminalBoundary({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, state: 'completed',
    })).toBe(true)
    expect(await reserveChatSessionStart({
      chatId: 'chat-1', admissionId: 'stale-replacement', now: baseTime,
      expectedTerminal: {
        eveSessionId: 'eve-session-1', sessionOrdinal: 1, sessionState: 'completed', eveNextStreamIndex: 0,
      },
    })).toBeNull()
    const replacement = await reserveChatSessionStart({
      chatId: 'chat-1', admissionId: 'replacement', now: baseTime,
      expectedTerminal: {
        eveSessionId: 'eve-session-1', sessionOrdinal: 1, sessionState: 'completed', eveNextStreamIndex: 1,
      },
    })
    expect(replacement).toMatchObject({sessionOrdinal: 2, sessionState: 'admitting', eveSessionId: null, eveNextStreamIndex: 0})
  })

  it('allows replacement when a matching committed terminal boundary precedes trailing events', async () => {
    await startAndAttach()
    await persistEvent({sessionOrdinal: 1, streamIndex: 0, type: 'session.completed'})
    await persistEvent({sessionOrdinal: 1, streamIndex: 1, type: 'session.started'})

    const replacement = await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'replacement', now: baseTime})
    expect(replacement).toMatchObject({sessionOrdinal: 2, sessionState: 'admitting'})
  })

  it('appends one positional safe missing-session failure while preserving prior transcript', async () => {
    await startAndAttach()
    await persistEvent({sessionOrdinal: 1, streamIndex: 0, type: 'session.started'})

    expect(await persistMissingChatSessionFailure({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, streamIndex: 1, now: baseTime,
    })).toBe(true)
    expect(await persistMissingChatSessionFailure({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, streamIndex: 1, now: baseTime,
    })).toBe(false)

    const events = await db.select().from(teamDataAssistantChatEvents)
      .orderBy(asc(teamDataAssistantChatEvents.streamIndex))
    expect(events.map(row => row.event)).toEqual([
      {type: 'session.started'},
      {
        type: 'session.failed',
        data: {
          code: 'CHAT_SESSION_UNAVAILABLE',
          message: 'This chat session could not be resumed.',
          sessionId: 'redacted-session',
        },
      },
    ])
    expect(JSON.stringify(events)).not.toMatch(/provider|stack|raw Eve/i)
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({
      eveNextStreamIndex: 2, eveSessionState: 'failed', eveTurnStartedAt: null,
    })
  })

  it('makes stale session and ordinal event or terminal writes no-ops', async () => {
    await startAndAttach()
    await persistEvent({sessionOrdinal: 1, streamIndex: 0, type: 'session.completed'})
    await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'replacement', now: baseTime})
    await attachChatSessionStart({
      chatId: 'chat-1', sessionOrdinal: 2, admissionId: 'replacement', eveSessionId: 'eve-session-2', eveContinuationToken: 'token-2', now: baseTime,
    })

    expect(await persistEvent({sessionOrdinal: 1, streamIndex: 1, type: 'session.failed'})).toEqual({status: 'stale'})
    expect(await markCurrentChatSessionFailed({chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, now: baseTime})).toBe(false)
    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({eveSessionId: 'eve-session-2', eveSessionOrdinal: 2, eveSessionState: 'running', eveNextStreamIndex: 0})
    expect(await db.select().from(teamDataAssistantChatEvents).where(eq(teamDataAssistantChatEvents.id, 'event-1-1'))).toHaveLength(0)
  })

  it('resets seeded chat runtime state without changing unrelated rows or chat metadata', async () => {
    await db.update(teamDataAssistantChats).set({
      eveSessionId: 'pre-migration-session',
      eveContinuationToken: 'pre-migration-token',
      eveSessionOrdinal: 7,
      eveNextStreamIndex: 9,
      eveSessionState: 'running',
      eveTurnStartedAt: baseTime,
      eveAdmissionId: 'pre-migration-admission',
    }).where(eq(teamDataAssistantChats.id, 'chat-1'))
    const migration = readFileSync(new URL('../../drizzle/0030_reset_assistant_chat_runtime_state.sql', import.meta.url), 'utf8')
    await sql.unsafe(migration)

    const [chat] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(chat).toMatchObject({
      id: 'chat-1', teamId: 'team-1', userId: 'user-1', lastUsedAt: baseTime,
      eveSessionId: null, eveContinuationToken: null, eveSessionOrdinal: 0, eveNextStreamIndex: 0,
      eveSessionState: 'none', eveTurnStartedAt: null, eveAdmissionId: null,
    })
    expect(await db.select().from(teams).where(eq(teams.id, 'team-1'))).toEqual([
      expect.objectContaining({id: 'team-1', name: 'Team One'}),
    ])
    expect(await db.select().from(teamMembers).where(eq(teamMembers.id, 'member-1'))).toEqual([
      expect.objectContaining({teamId: 'team-1', userId: 'user-1', role: 'owner'}),
    ])
    expect(await db.select().from(user).where(eq(user.id, 'user-1'))).toEqual([
      expect.objectContaining({id: 'user-1', email: 'user@example.com'}),
    ])
  })

  it('reads and resolves only exact current-session pending approvals without exposing handles in the result', async () => {
    await startAndAttach()
    await db.insert(teamDataAssistantChatApprovals).values([
      {
        id: 'approval-ready', chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
        requestId: 'request-ready', callId: 'call-ready', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'ready', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
      },
      {
        id: 'approval-blocked', chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
        requestId: 'request-blocked', callId: 'call-blocked', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'blocked', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
      },
      {
        id: 'approval-old', chatId: 'chat-1', eveSessionId: 'old-session', sessionOrdinal: 0,
        requestId: 'request-old', callId: 'call-old', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'ready', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
      },
    ])

    const pending = await listPendingChatApprovals({chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1})
    expect(pending).toEqual([
      {
        requestId: 'request-blocked', callId: 'call-blocked', toolName: 'manageCategory',
        projectionStatus: 'blocked', resolutionStatus: 'pending',
      },
      {
        requestId: 'request-ready', callId: 'call-ready', toolName: 'manageCategory',
        projectionStatus: 'ready', resolutionStatus: 'pending',
      },
    ])
    expect(JSON.stringify(pending)).not.toContain('eve-session-1')

    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      requestId: 'request-blocked', resolution: 'approved', now: baseTime,
    })).toEqual({status: 'not-found-or-blocked'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      requestId: 'request-blocked', resolution: 'denied', now: baseTime,
    })).toEqual({status: 'transitioned'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      requestId: 'request-blocked', resolution: 'denied', now: baseTime,
    })).toEqual({status: 'already-resolved'})
    expect(await markChatApprovalResolution({
      chatId: 'chat-1', eveSessionId: 'old-session', sessionOrdinal: 0,
      requestId: 'request-old', resolution: 'approved', now: baseTime,
    })).toEqual({status: 'not-found-or-blocked'})
  })

  it('claims a complete approval response set all-or-none and atomically restores exact claims with the lease', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    await db.insert(teamDataAssistantChatApprovals).values([
      {
        id: 'approval-ready', chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
        requestId: 'request-ready', callId: 'call-ready', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'ready', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
      },
      {
        id: 'approval-blocked', chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
        requestId: 'request-blocked', callId: 'call-blocked', toolName: 'manageCategory', safeProposal: null,
        projectionStatus: 'blocked', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
      },
    ])
    const reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1, now: baseTime,
    })
    if (!reserved?.turnStartedAt) throw new Error('Expected follow-up lease')
    if (!reserved.admissionId || reserved.followUpPreTurnCursor === null) throw new Error('Expected delivery marker')
    let lease = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      turnStartedAt: reserved.turnStartedAt,
      admissionId: reserved.admissionId,
      preTurnCursor: reserved.followUpPreTurnCursor,
    }

    for (const responses of [
      [
        {requestId: 'request-ready', optionId: 'approve'},
        {requestId: 'missing-second-response', optionId: 'deny'},
      ],
      [
        {requestId: 'request-ready', optionId: 'approve'},
        {requestId: 'request-ready', optionId: 'deny'},
      ],
      [{requestId: 'request-blocked', optionId: 'approve'}],
    ] as const) {
      expect(await claimChatApprovalResponses({...lease, responses, now: baseTime})).toEqual({status: 'rejected'})
      expect((await db.select().from(teamDataAssistantChatApprovals).orderBy(asc(teamDataAssistantChatApprovals.requestId)))
        .map(row => [row.requestId, row.resolutionStatus])).toEqual([
        ['request-blocked', 'pending'], ['request-ready', 'pending'],
      ])
    }

    const responses = [
      {requestId: 'request-ready', optionId: 'approve'},
      {requestId: 'request-blocked', optionId: 'deny'},
    ] as const
    expect(await releaseDefinitiveChatFollowUpRejection({
      ...lease, claimedResponses: responses, allowUnclaimedResponses: true, now: baseTime,
    })).toBe(true)
    expect((await db.select().from(teamDataAssistantChatApprovals))
      .every(row => row.resolutionStatus === 'pending')).toBe(true)
    const retried = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      now: new Date(baseTime.getTime() + 1),
    })
    if (!retried?.turnStartedAt) throw new Error('Expected retried follow-up lease')
    if (!retried.admissionId || retried.followUpPreTurnCursor === null) throw new Error('Expected retried delivery marker')
    lease = {
      ...lease,
      turnStartedAt: retried.turnStartedAt,
      admissionId: retried.admissionId,
      preTurnCursor: retried.followUpPreTurnCursor,
    }

    expect(await claimChatApprovalResponses({...lease, responses, now: baseTime})).toEqual({status: 'claimed'})
    expect((await db.select().from(teamDataAssistantChatApprovals).orderBy(asc(teamDataAssistantChatApprovals.requestId)))
      .map(row => [row.requestId, row.resolutionStatus])).toEqual([
      ['request-blocked', 'denied'], ['request-ready', 'approved'],
    ])

    expect(await releaseDefinitiveChatFollowUpRejection({...lease, claimedResponses: responses, now: baseTime})).toBe(true)
    expect((await db.select().from(teamDataAssistantChatApprovals).orderBy(asc(teamDataAssistantChatApprovals.requestId)))
      .map(row => [row.requestId, row.resolutionStatus])).toEqual([
      ['request-blocked', 'pending'], ['request-ready', 'pending'],
    ])
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({
      eveSessionState: 'waiting', eveTurnStartedAt: null,
    })
  })

  it('restores only an exact unadvanced ambiguous follow-up and its admission-owned approvals', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    await db.insert(teamDataAssistantChatApprovals).values({
      id: 'approval-ready', chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      requestId: 'request-ready', callId: 'call-ready', toolName: 'manageCategory', safeProposal: null,
      projectionStatus: 'ready', resolutionStatus: 'pending', createdAt: baseTime, updatedAt: baseTime,
    })
    const reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'follow-up-1', now: baseTime,
    })
    if (!reserved?.turnStartedAt || reserved.followUpPreTurnCursor === null) throw new Error('Expected follow-up marker')
    const exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'follow-up-1', preTurnCursor: reserved.followUpPreTurnCursor,
    }
    expect(reserved).toMatchObject({
      sessionState: 'running', admissionId: 'follow-up-1',
      followUpDeliveryState: 'pending', followUpPreTurnCursor: 1,
    })
    expect(await claimChatApprovalResponses({
      ...exact, turnStartedAt: reserved.turnStartedAt,
      responses: [{requestId: 'request-ready', optionId: 'approve'}], now: baseTime,
    })).toEqual({status: 'claimed'})
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
    expect(await markChatFollowUpDeliveryAmbiguous(exact)).toBe(true)

    expect(await restoreUnadmittedChatFollowUp({...exact, admissionId: 'stale-admission'})).toBe(false)
    expect(await restoreUnadmittedChatFollowUp({...exact, preTurnCursor: 0})).toBe(false)
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(true)
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'stale'})

    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({
      eveSessionState: 'waiting', eveAdmissionId: null,
      eveFollowUpDeliveryState: 'none', eveFollowUpPreTurnCursor: null,
      eveSessionId: 'eve-session-1', eveContinuationToken: 'token-1', eveNextStreamIndex: 1,
    })
    expect((await db.select().from(teamDataAssistantChatApprovals))[0]).toMatchObject({
      resolutionStatus: 'pending', eveClaimedByAdmissionId: null,
    })
    expect(await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'follow-up-retry', now: new Date(baseTime.getTime() + 1),
    })).toMatchObject({admissionId: 'follow-up-retry', followUpDeliveryState: 'pending'})
  })

  it('promotes only an exact pending dispatch strictly after its durable cutoff, then permits no-event recovery', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    const reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'pending-dispatch', now: baseTime,
    })
    if (!reserved?.turnStartedAt || reserved.followUpPreTurnCursor === null) throw new Error('Expected pending dispatch')
    const exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'pending-dispatch', preTurnCursor: reserved.followUpPreTurnCursor,
      turnStartedAt: reserved.turnStartedAt,
    }
    const cutoff = new Date(baseTime.getTime() + CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS)

    expect(await promoteStalePendingChatFollowUp({...exact, now: new Date(cutoff.getTime() - 1)})).toBe(false)
    expect(await promoteStalePendingChatFollowUp({...exact, now: cutoff})).toBe(false)
    for (const stale of [
      {...exact, eveSessionId: 'wrong-session'},
      {...exact, sessionOrdinal: 2},
      {...exact, admissionId: 'wrong-admission'},
      {...exact, preTurnCursor: exact.preTurnCursor + 1},
      {...exact, turnStartedAt: new Date(exact.turnStartedAt.getTime() + 1)},
    ]) {
      expect(await promoteStalePendingChatFollowUp({...stale, now: new Date(cutoff.getTime() + 1)})).toBe(false)
    }
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
    expect(await promoteStalePendingChatFollowUp({...exact, now: new Date(cutoff.getTime() + 1)})).toBe(true)
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(true)
  })

  it('makes acknowledgement and stale pending takeover safe in either race order', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    let reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'ack-first', now: baseTime,
    })
    if (!reserved?.turnStartedAt || reserved.followUpPreTurnCursor === null) throw new Error('Expected first dispatch')
    let exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'ack-first', preTurnCursor: reserved.followUpPreTurnCursor,
      turnStartedAt: reserved.turnStartedAt,
    }
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'acknowledged'})
    expect(await promoteStalePendingChatFollowUp({
      ...exact, now: new Date(baseTime.getTime() + CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS + 1),
    })).toBe(false)
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)

    await persistEvent({sessionOrdinal: 1, streamIndex: 1, type: 'session.waiting'})
    const secondStartedAt = new Date(baseTime.getTime() + 1)
    reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'takeover-first', now: secondStartedAt,
    })
    if (!reserved?.turnStartedAt || reserved.followUpPreTurnCursor === null) throw new Error('Expected second dispatch')
    exact = {
      ...exact,
      admissionId: 'takeover-first',
      preTurnCursor: reserved.followUpPreTurnCursor,
      turnStartedAt: reserved.turnStartedAt,
    }
    expect(await promoteStalePendingChatFollowUp({
      ...exact, now: new Date(secondStartedAt.getTime() + CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS + 1),
    })).toBe(true)
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'acknowledged'})
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
  })

  it('promotes a lost pending receipt but durable event advancement prevents rollback', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    const reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'lost-receipt', now: baseTime,
    })
    if (!reserved?.turnStartedAt || reserved.followUpPreTurnCursor === null) throw new Error('Expected lost receipt dispatch')
    const exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'lost-receipt', preTurnCursor: reserved.followUpPreTurnCursor,
      turnStartedAt: reserved.turnStartedAt,
    }
    await persistEvent({sessionOrdinal: 1, streamIndex: 1, type: 'turn.started'})

    expect(await promoteStalePendingChatFollowUp({
      ...exact, now: new Date(baseTime.getTime() + CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS + 1),
    })).toBe(true)
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'acknowledged'})
  })

  it('never restores acknowledged or cursor-advanced delivery, and a concurrent boundary wins', async () => {
    const attached = await startAndAttach()
    await persistEvent({sessionOrdinal: attached.sessionOrdinal, streamIndex: 0, type: 'session.waiting'})
    let reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'acknowledged', now: baseTime,
    })
    if (!reserved || reserved.followUpPreTurnCursor === null) throw new Error('Expected follow-up marker')
    let exact = {
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'acknowledged', preTurnCursor: reserved.followUpPreTurnCursor,
    }
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'acknowledged'})
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)

    await persistEvent({sessionOrdinal: 1, streamIndex: 1, type: 'session.waiting'})
    reserved = await reserveChatFollowUp({
      chatId: 'chat-1', eveSessionId: 'eve-session-1', sessionOrdinal: 1,
      admissionId: 'advanced', now: new Date(baseTime.getTime() + 1),
    })
    if (!reserved || reserved.followUpPreTurnCursor === null) throw new Error('Expected advanced marker')
    exact = {...exact, admissionId: 'advanced', preTurnCursor: reserved.followUpPreTurnCursor}
    await persistEvent({sessionOrdinal: 1, streamIndex: 2, type: 'turn.started'})
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'acknowledged'})
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)

    await persistEvent({sessionOrdinal: 1, streamIndex: 3, type: 'session.waiting'})
    expect(await markChatFollowUpDeliveryAcknowledged(exact)).toEqual({status: 'proven-delivery'})
    expect((await db.select().from(teamDataAssistantChats))[0]).toMatchObject({
      eveSessionState: 'waiting', eveFollowUpDeliveryState: 'none', eveAdmissionId: null,
    })
    expect(await restoreUnadmittedChatFollowUp(exact)).toBe(false)
  })

  it('reaps unresolved admissions at exactly two minutes', async () => {
    await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'orphan', now: baseTime})
    expect(await reapStaleChatAdmissions({now: new Date(baseTime.getTime() + 119_999)})).toEqual([])
    expect(await reapStaleChatAdmissions({now: new Date(baseTime.getTime() + 120_000)})).toEqual([
      expect.objectContaining({chatId: 'chat-1', sessionOrdinal: 1, admissionId: 'orphan'}),
    ])
    const [row] = await db.select().from(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(row).toMatchObject({eveSessionState: 'failed', eveAdmissionId: null, eveTurnStartedAt: null})
  })

  it('bounds each stale admission reap batch', async () => {
    await db.insert(teamDataAssistantChats).values(Array.from({length: 105}, (_, index) => ({
      id: `stale-chat-${index}`,
      teamId: 'team-1',
      userId: 'user-1',
      createdAt: baseTime,
      updatedAt: baseTime,
      lastUsedAt: baseTime,
      eveSessionState: 'admitting',
      eveTurnStartedAt: baseTime,
      eveAdmissionId: `admission-${index}`,
    })))

    const first = await reapStaleChatAdmissions({now: new Date(baseTime.getTime() + 120_000)})
    expect(first).toHaveLength(100)
    expect(await db.select().from(teamDataAssistantChats)
      .where(eq(teamDataAssistantChats.eveSessionState, 'admitting'))).toHaveLength(5)

    const second = await reapStaleChatAdmissions({now: new Date(baseTime.getTime() + 120_000)})
    expect(second).toHaveLength(5)
    expect(await db.select().from(teamDataAssistantChats)
      .where(eq(teamDataAssistantChats.eveSessionState, 'admitting'))).toHaveLength(0)
  })

  it('persists events in ordinal/index order and cascades projections when only the chat is deleted', async () => {
    await startAndAttach()
    await persistEvent({sessionOrdinal: 1, streamIndex: 0, type: 'session.completed'})
    await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'second', now: baseTime})
    await attachChatSessionStart({chatId: 'chat-1', sessionOrdinal: 2, admissionId: 'second', eveSessionId: 'eve-session-2', eveContinuationToken: 'token-2', now: baseTime})
    await persistEvent({sessionOrdinal: 2, streamIndex: 0, type: 'input.requested', approval: true})

    const events = await db.select().from(teamDataAssistantChatEvents).orderBy(
      asc(teamDataAssistantChatEvents.sessionOrdinal),
      asc(teamDataAssistantChatEvents.streamIndex),
    )
    expect(events.map(event => [event.sessionOrdinal, event.streamIndex])).toEqual([[1, 0], [2, 0]])
    expect(await db.select().from(teamDataAssistantChatApprovals)).toHaveLength(1)

    await db.delete(teamDataAssistantChats).where(eq(teamDataAssistantChats.id, 'chat-1'))
    expect(await db.select().from(teamDataAssistantChatEvents)).toHaveLength(0)
    expect(await db.select().from(teamDataAssistantChatApprovals)).toHaveLength(0)
    expect(await db.select().from(teams).where(eq(teams.id, 'team-1'))).toHaveLength(1)
    expect(await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, 'team-1'), eq(teamMembers.userId, 'user-1')))).toHaveLength(1)
  })
})

async function startAndAttach() {
  const reserved = await reserveChatSessionStart({chatId: 'chat-1', admissionId: 'admission-1', now: baseTime})
  expect(reserved).not.toBeNull()
  const attached = await attachChatSessionStart({
    chatId: 'chat-1', sessionOrdinal: reserved!.sessionOrdinal, admissionId: 'admission-1',
    eveSessionId: 'eve-session-1', eveContinuationToken: 'token-1', now: baseTime,
  })
  expect(attached).not.toBeNull()
  return attached!
}

async function persistEvent(input: {sessionOrdinal: number; streamIndex: number; type?: string; approval?: boolean}) {
  const type = input.type ?? 'message.delta'
  const event = input.approval
    ? {
        type,
        data: {
          sequence: 1,
          stepIndex: 0,
          turnId: 'turn-1',
          requests: [{
            requestId: 'request-1',
            action: {kind: 'tool-call', callId: 'call-1', toolName: 'manageCategory', input: {}},
          }],
        },
      }
    : {type}
  return unsafePersistChatRuntimeEventForTest({
    chatId: 'chat-1',
    eveSessionId: `eve-session-${input.sessionOrdinal}`,
    sessionOrdinal: input.sessionOrdinal,
    streamIndex: input.streamIndex,
    event: {
      id: `event-${input.sessionOrdinal}-${input.streamIndex}`,
      type,
      event,
      occurredAt: new Date(baseTime.getTime() + input.streamIndex),
      createdAt: new Date(baseTime.getTime() + input.streamIndex),
    },
  } as unknown as UnsafePersistChatRuntimeEventInputForTest)
}

async function seedChat(chatId: string) {
  await db.insert(user).values({
    id: 'user-1', name: 'User One', email: 'user@example.com', emailVerified: true,
    createdAt: baseTime, updatedAt: baseTime,
  })
  await db.insert(teams).values({id: 'team-1', name: 'Team One', createdAt: baseTime, updatedAt: baseTime})
  await db.insert(teamMembers).values({
    id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: baseTime, updatedAt: baseTime,
  })
  await db.insert(teamDataAssistantChats).values({
    id: chatId, teamId: 'team-1', userId: 'user-1', createdAt: baseTime, updatedAt: baseTime, lastUsedAt: baseTime,
  })
}
