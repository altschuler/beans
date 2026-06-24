export type PersonalTeamUser = {
  id: string
  email: string
  name?: string | null
}

export type TeamRepository = {
  findPersonalTeam(userId: string): Promise<{id: string} | null>
  createPersonalTeam(input: {
    team: {id: string; name: string; personalOwnerUserId: string; createdAt: Date; updatedAt: Date}
    membership: {id: string; teamId: string; userId: string; role: 'owner'; createdAt: Date; updatedAt: Date}
  }): Promise<string>
}

export async function ensurePersonalTeamForUser(repo: TeamRepository, user: PersonalTeamUser) {
  const existing = await repo.findPersonalTeam(user.id)

  if (existing) {
    return existing.id
  }

  const now = new Date()
  const teamId = crypto.randomUUID()
  const label = user.name?.trim() || user.email

  return repo.createPersonalTeam({
    team: {
      id: teamId,
      name: `${label}'s team`,
      personalOwnerUserId: user.id,
      createdAt: now,
      updatedAt: now,
    },
    membership: {
      id: crypto.randomUUID(),
      teamId,
      userId: user.id,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    },
  })
}
