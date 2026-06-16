import {describe, expect, it, vi} from 'vitest'
import {ensurePersonalTeamForUser, type TeamRepository} from '@/teams/personal-team'

function repository(overrides: Partial<TeamRepository> = {}): TeamRepository {
  return {
    findPersonalTeam: vi.fn(async () => null),
    createPersonalTeam: vi.fn(async input => input.team.id),
    ...overrides,
  }
}

describe('ensurePersonalTeamForUser', () => {
  it('returns an existing personal team', async () => {
    const repo = repository({findPersonalTeam: vi.fn(async () => ({id: 'team-1'}))})

    await expect(ensurePersonalTeamForUser(repo, {id: 'user-1', email: 'ada@example.com', name: 'Ada'})).resolves.toBe(
      'team-1',
    )

    expect(repo.createPersonalTeam).not.toHaveBeenCalled()
  })

  it('creates a team and owner membership when missing', async () => {
    const repo = repository()

    const teamId = await ensurePersonalTeamForUser(repo, {id: 'user-1', email: 'ada@example.com', name: 'Ada'})

    expect(repo.createPersonalTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        team: expect.objectContaining({id: teamId, name: "Ada's team", personalOwnerUserId: 'user-1'}),
        membership: expect.objectContaining({teamId, userId: 'user-1', role: 'owner'}),
      }),
    )
  })

  it('returns the persisted personal team id after create', async () => {
    const repo = repository({createPersonalTeam: vi.fn(async () => 'persisted-team-1')})

    await expect(ensurePersonalTeamForUser(repo, {id: 'user-1', email: 'ada@example.com'})).resolves.toBe('persisted-team-1')
  })
})
