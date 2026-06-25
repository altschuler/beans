import '@tanstack/react-start/server-only'

import {eq} from 'drizzle-orm'
import {ensureSession} from '@/auth/session'
import {db} from '@/db/client'
import {teamMembers, teams} from '@penge/domain/schema'
import {seedDefaultLedgerChartForTeam} from '@/ledger/repository.server'
import {ensurePersonalTeamForUser, type TeamRepository} from './personal-team'

export const drizzleTeamRepository: TeamRepository = {
  async findPersonalTeam(userId) {
    const [team] = await db.select({id: teams.id}).from(teams).where(eq(teams.personalOwnerUserId, userId)).limit(1)
    return team ?? null
  },
  async createPersonalTeam(input) {
    return db.transaction(async tx => {
      await tx.insert(teams).values(input.team).onConflictDoNothing({target: teams.personalOwnerUserId})

      const [team] = await tx
        .select({id: teams.id})
        .from(teams)
        .where(eq(teams.personalOwnerUserId, input.team.personalOwnerUserId))
        .limit(1)

      const teamId = team?.id ?? input.team.id

      await tx
        .insert(teamMembers)
        .values({...input.membership, teamId})
        .onConflictDoNothing({target: [teamMembers.teamId, teamMembers.userId]})

      await seedDefaultLedgerChartForTeam(tx, teamId)

      return teamId
    })
  },
}

export async function ensureCurrentUserPersonalTeamServer() {
  const session = await ensureSession()
  return ensurePersonalTeamForUser(drizzleTeamRepository, {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  })
}
