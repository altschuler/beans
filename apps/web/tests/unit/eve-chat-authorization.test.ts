import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {db} from '@/db/client'
import {getAuthorizedChat} from '@/eve/eve-chat-proxy.server'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {teamDataAssistantChats, teamMembers, teams, user} from '@penge/domain/schema'

const now = new Date('2026-07-11T10:00:00.000Z')

beforeAll(migrateDatabase)
beforeEach(async () => {
  await resetDatabase()
  await db.insert(user).values([
    testUser('owner'),
    testUser('teammate'),
    testUser('outsider'),
    testUser('former-member'),
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team one', personalOwnerUserId: 'owner', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Team two', personalOwnerUserId: 'outsider', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    membership('member-owner', 'team-1', 'owner'),
    membership('member-teammate', 'team-1', 'teammate'),
    membership('member-outsider', 'team-2', 'outsider'),
  ])
  await db.insert(teamDataAssistantChats).values([
    chat('owned-chat', 'owner'),
    chat('former-member-chat', 'former-member'),
  ])
})
afterAll(closeDatabase)

describe('getAuthorizedChat', () => {
  it('requires both chat ownership and current team membership', async () => {
    await expect(getAuthorizedChat({chatId: 'owned-chat', userId: 'owner'})).resolves.toEqual({
      chatId: 'owned-chat',
      teamId: 'team-1',
      userId: 'owner',
      eveSessionId: 'eve-session-1',
      eveContinuationToken: 'server-only-token',
    })
    await expect(getAuthorizedChat({chatId: 'owned-chat', userId: 'teammate'})).resolves.toBeNull()
    await expect(getAuthorizedChat({chatId: 'owned-chat', userId: 'outsider'})).resolves.toBeNull()
    await expect(getAuthorizedChat({chatId: 'former-member-chat', userId: 'former-member'})).resolves.toBeNull()
  })
})

function testUser(id: string) {
  return {id, name: id, email: `${id}@example.test`, emailVerified: true, image: null, createdAt: now, updatedAt: now}
}

function membership(id: string, teamId: string, userId: string) {
  return {id, teamId, userId, role: 'owner', createdAt: now, updatedAt: now}
}

function chat(id: string, userId: string) {
  return {
    id,
    teamId: 'team-1',
    userId,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    firstSubmittedAt: now,
    eveSessionId: 'eve-session-1',
    eveContinuationToken: 'server-only-token',
  }
}
