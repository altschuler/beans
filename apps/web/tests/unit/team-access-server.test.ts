import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {db} from '@/db/client'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {teamMembers, teams, user} from '@penge/domain/schema'
import {requireAccessibleTeamScope, requireCurrentPersonalTeamScope, userCanAccessTeam} from '@/teams/team-access.server'

const now = new Date('2026-06-27T10:00:00.000Z')

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  await resetDatabase()
  await seedTeamFixture()
})

afterAll(async () => {
  await closeDatabase()
})

describe('server team access helpers', () => {
  it('checks team membership from a neutral server module', async () => {
    await expect(userCanAccessTeam('team-1', 'user-1')).resolves.toBe(true)
    await expect(userCanAccessTeam('team-2', 'user-1')).resolves.toBe(false)
  })

  it('returns a trusted team scope only for accessible teams', async () => {
    await expect(requireAccessibleTeamScope({teamId: 'team-1', userId: 'user-1'})).resolves.toEqual({teamId: 'team-1', userId: 'user-1'})
    await expect(requireAccessibleTeamScope({teamId: 'team-2', userId: 'user-1'})).rejects.toThrow('Team not found')
  })

  it('resolves the current personal team scope for a user', async () => {
    await expect(requireCurrentPersonalTeamScope({userId: 'user-1'})).resolves.toEqual({teamId: 'team-1', userId: 'user-1'})
    await expect(requireCurrentPersonalTeamScope({userId: 'missing-user'})).rejects.toThrow('No active team found')
  })
})

async function seedTeamFixture() {
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other Team', personalOwnerUserId: 'user-2', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: now, updatedAt: now},
  ])
}
