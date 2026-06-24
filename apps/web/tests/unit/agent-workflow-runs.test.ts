import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {agentWorkflowRuns, teamMembers, teams, user} from '@/db/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {
  ActiveWorkflowRunExistsError,
  attachFlueRunId,
  markAgentWorkflowRunCompleted,
  markAgentWorkflowRunFailed,
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
      flueRunId: null,
      workflowName: 'categorize-transactions',
      teamId: 'team-1',
      requestedByUserId: 'user-1',
      status: 'active',
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
    ).resolves.toMatchObject({id: 'different-workflow', status: 'active'})

    await expect(
      reserveActiveAgentWorkflowRun(sql, {
        id: 'different-team',
        teamId: 'team-2',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now,
      }),
    ).resolves.toMatchObject({id: 'different-team', status: 'active'})
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
      reserveActiveAgentWorkflowRun(sql, {
        id: 'run-2',
        teamId: 'team-1',
        workflowName: 'categorize-transactions',
        requestedByUserId: 'user-1',
        now: new Date('2026-06-24T10:02:00.000Z'),
      }),
    ).resolves.toMatchObject({id: 'run-2', status: 'active'})
  })

  it('attaches Flue ids and marks admission failures without leaving runs active', async () => {
    await reserveActiveAgentWorkflowRun(sql, {
      id: 'run-1',
      teamId: 'team-1',
      workflowName: 'categorize-transactions',
      requestedByUserId: 'user-1',
      now,
    })

    await expect(
      attachFlueRunId(sql, {id: 'run-1', flueRunId: 'flue-run-1', now: new Date('2026-06-24T10:01:00.000Z')}),
    ).resolves.toMatchObject({id: 'run-1', flueRunId: 'flue-run-1', status: 'active'})

    const failed = await markAgentWorkflowRunFailed(sql, {
      id: 'run-1',
      error: 'Flue rejected the workflow submission because the sidecar is unavailable',
      now: new Date('2026-06-24T10:02:00.000Z'),
    })

    expect(failed).toMatchObject({id: 'run-1', status: 'failed', error: 'Flue rejected the workflow submission because the sidecar is unavailable'})
    expect(failed.finishedAt).toEqual(new Date('2026-06-24T10:02:00.000Z'))

    const rows = await db.select().from(agentWorkflowRuns).where(eq(agentWorkflowRuns.id, 'run-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({status: 'failed'})
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
