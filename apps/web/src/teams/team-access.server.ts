import '@tanstack/react-start/server-only'

import {and, desc, eq} from 'drizzle-orm'
import type {TrustedTeamScope} from '@penge/domain/team-scope'
import {teamMembers} from '@penge/domain/schema'
import {db} from '@/db/client'

export async function userCanAccessTeam(teamId: string, userId: string) {
  const [membership] = await db
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  return Boolean(membership)
}

export async function requireAccessibleTeamScope(input: {userId: string; teamId: string}): Promise<TrustedTeamScope> {
  if (!(await userCanAccessTeam(input.teamId, input.userId))) {
    throw new Error('Team not found')
  }
  return {userId: input.userId, teamId: input.teamId}
}

export async function requireCurrentPersonalTeamScope(input: {userId: string}): Promise<TrustedTeamScope> {
  const [row] = await db
    .select({teamId: teamMembers.teamId})
    .from(teamMembers)
    .where(eq(teamMembers.userId, input.userId))
    .orderBy(desc(teamMembers.createdAt))
    .limit(1)

  if (!row) throw new Error('No active team found')
  return {userId: input.userId, teamId: row.teamId}
}
