const TEAM_DATA_ASSISTANT_ID_PREFIX = 'team-data:'

type TeamDataAssistantScope = {
  teamId: string
  userId: string
  chatId?: string
}

export function encodeTeamDataAssistantId(input: TeamDataAssistantScope) {
  return `${TEAM_DATA_ASSISTANT_ID_PREFIX}${encodeURIComponent(JSON.stringify({teamId: input.teamId, userId: input.userId, ...(input.chatId ? {chatId: input.chatId} : {})}))}`
}

export function decodeTeamDataAssistantId(id: string): TeamDataAssistantScope | null {
  if (!id.startsWith(TEAM_DATA_ASSISTANT_ID_PREFIX)) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(id.slice(TEAM_DATA_ASSISTANT_ID_PREFIX.length))) as Partial<TeamDataAssistantScope>
    if (typeof parsed.teamId !== 'string' || typeof parsed.userId !== 'string') return null
    if (!parsed.teamId || !parsed.userId) return null
    if (parsed.chatId !== undefined && (typeof parsed.chatId !== 'string' || !parsed.chatId)) return null
    return {teamId: parsed.teamId, userId: parsed.userId, ...(parsed.chatId ? {chatId: parsed.chatId} : {})}
  } catch {
    return null
  }
}
