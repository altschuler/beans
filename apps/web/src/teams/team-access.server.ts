import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
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
