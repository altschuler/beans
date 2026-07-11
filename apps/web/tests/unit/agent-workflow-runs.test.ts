import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {agentWorkflowRuns, teamMembers, teams, user} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {
  ActiveWorkflowRunExistsError,
  advanceAgentWorkflowRunEveCursor,
  attachEveSessionToAgentWorkflowRun,
  failStaleActiveAgentWorkflowRuns,
  markAgentWorkflowRunCompleted,
  markAgentWorkflowRunFailed,
  markRunningAgentWorkflowRunCompleted,
  reserveActiveAgentWorkflowRun,
} from '@penge/domain/workflow-runs'

const now = new Date('2026-06-24T10:00:00.000Z')

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  await resetDatabase()
  await seedTeam()
})

afterAll(async () => {
  await closeDatabase()
})

describe('agent workflow run repository', () => {
  it('reserves one active app workflow run per team and workflow name', async () => {
    const first = await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })

    expect(first).toMatchObject({
      id: 'run-1',
      workflowName: 'categorize-transactions',
      teamId: 'team-1',
      requestedByUserId: 'user-1',
      status: 'pending',
      error: null,
      finishedAt: null,
    })

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'run-duplicate',
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now,
      }),
    ).rejects.toBeInstanceOf(ActiveWorkflowRunExistsError)

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'different-workflow',
        teamId: 'team-1',
        workflowName: 'other-workflow',
        requestedByUserId: 'user-1',
        now,
      }),
    ).resolves.toMatchObject({id: 'different-workflow', status: 'pending'})

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'different-team',
        teamId: 'team-2',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now,
      }),
    ).resolves.toMatchObject({id: 'different-team', status: 'pending'})
  })

  it('allows a new run after the previous run is completed', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })
    await markAgentWorkflowRunCompleted(sql, {id: 'run-1', now: new Date('2026-06-24T10:01:00.000Z')})

    await expect(
      markAgentWorkflowRunCompleted(sql, {id: 'run-1', now: new Date('2026-06-24T10:01:30.000Z')}),
    ).resolves.toMatchObject({id: 'run-1', status: 'completed', finishedAt: new Date('2026-06-24T10:01:00.000Z')})

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'run-2',
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now: new Date('2026-06-24T10:02:00.000Z'),
      }),
    ).resolves.toMatchObject({id: 'run-2', status: 'pending'})
  })

  it('attaches eve session cursors to active app workflow runs', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })

    const attached = await attachEveSessionToAgentWorkflowRun(sql, {
      id: 'run-1',
      eveSessionId: 'eve-session-1',
      eveNextStreamIndex: 7,
      now: new Date('2026-06-24T10:01:00.000Z'),
    })

    expect(attached).toMatchObject({
      id: 'run-1',
      eveSessionId: 'eve-session-1',
      eveNextStreamIndex: 7,
      status: 'running',
      updatedAt: new Date('2026-06-24T10:01:00.000Z'),
    })
  })

  it('marks an Eve admission failure terminal without leaving the reserved run active', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })

    const failed = await markAgentWorkflowRunFailed(sql, {
      id: 'run-1',
      error: 'Eve rejected the task admission',
      now: new Date('2026-06-24T10:02:00.000Z'),
    })

    expect(failed).toMatchObject({
      id: 'run-1',
      status: 'failed',
      error: 'Eve rejected the task admission',
      finishedAt: new Date('2026-06-24T10:02:00.000Z'),
    })
    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'run-2',
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now: new Date('2026-06-24T10:03:00.000Z'),
      }),
    ).resolves.toMatchObject({id: 'run-2', status: 'pending'})
  })

  it('does not let the Eve terminal fast path settle a run before session attachment', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1', teamId: 'team-1', workflowName: 'categorize-transactions', requestedByUserId: 'user-1', now,
    })

    await expect(markRunningAgentWorkflowRunCompleted(sql, {id: 'run-1', now})).rejects.toMatchObject({
      code: 'AGENT_WORKFLOW_RUN_NOT_FOUND',
    })
    await attachEveSessionToAgentWorkflowRun(sql, {id: 'run-1', eveSessionId: 'eve-session-1', now})
    await expect(markRunningAgentWorkflowRunCompleted(sql, {id: 'run-1', now})).resolves.toMatchObject({
      id: 'run-1', status: 'completed',
    })
  })

  it('advances a running Eve cursor monotonically for the mapped session', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1', teamId: 'team-1', workflowName: 'categorize-transactions', requestedByUserId: 'user-1', now,
    })
    await attachEveSessionToAgentWorkflowRun(sql, {id: 'run-1', eveSessionId: 'eve-session-1', eveNextStreamIndex: 2, now})

    const cursorAdvancedAt = new Date('2026-06-24T10:05:00.000Z')
    await expect(advanceAgentWorkflowRunEveCursor(sql, {
      id: 'run-1', eveSessionId: 'eve-session-1', eveNextStreamIndex: 7, now: cursorAdvancedAt,
    })).resolves.toMatchObject({eveNextStreamIndex: 7, status: 'running', updatedAt: now})
    await expect(advanceAgentWorkflowRunEveCursor(sql, {
      id: 'run-1', eveSessionId: 'eve-session-1', eveNextStreamIndex: 4, now: cursorAdvancedAt,
    })).resolves.toMatchObject({eveNextStreamIndex: 7, updatedAt: now})
  })

  it('does not fail stale active runs after eve has admitted a session', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'eve-run',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })
    await attachEveSessionToAgentWorkflowRun(sql, {
      id: 'eve-run',
      eveSessionId: 'eve-session-1',
      now: new Date('2026-06-24T10:01:00.000Z'),
    })

    await expect(
      failStaleActiveAgentWorkflowRuns(sql, {
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        staleBefore: new Date('2026-06-24T10:05:00.000Z'),
        now: new Date('2026-06-24T10:06:00.000Z'),
      }),
    ).resolves.toEqual([])

    const rows = await db.select().from(agentWorkflowRuns).where(eq(agentWorkflowRuns.id, 'eve-run'))
    expect(rows[0]).toMatchObject({status: 'running', eveSessionId: 'eve-session-1'})
  })

  it('fails stale preparing runs so a new run can be reserved', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'stale-run',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })

    await expect(
      failStaleActiveAgentWorkflowRuns(sql, {
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        staleBefore: new Date('2026-06-24T10:05:00.000Z'),
        now: new Date('2026-06-24T10:06:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'stale-run',
        status: 'failed',
        error: 'Workflow did not report progress and was marked stale',
      }),
    ])

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'new-run',
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now: new Date('2026-06-24T10:07:00.000Z'),
      }),
    ).resolves.toMatchObject({id: 'new-run', status: 'pending'})
  })
})

async function seedTeam() {
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other Team', personalOwnerUserId: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
  ])
}
