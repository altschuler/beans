import {defineAgent, type AgentRouteHandler} from '@flue/runtime'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {createCategorizationReadTools} from '../agent-tools/read-tools'
import {createChatCategorizationWriteTools} from '../agent-tools/write-tools'

export const description = 'Answers questions about scoped team finance data and can apply confirmed categorization changes.'

export const teamDataAssistantInstructions = `You are Penge's team data assistant.

Scope and safety:
- Use only the trusted team and user scope encoded in this agent instance.
- Never ask the user for user ids, team ids, or unrestricted database filters.
- Use available read tools to inspect transactions, categories, bank accounts, and prior examples before answering.
- You can discuss categories and category groups, but this first slice cannot create, rename, edit, or delete categories or category groups.

Writes:
- You may apply categorization changes supported by the chat write tool: category, split, or transfer.
- Before any write, state a concrete proposal that names the transaction or transactions and the exact interpretation you intend to apply.
- Wait for natural confirmation of the latest concrete proposal, such as "yes", "sounds good", or "go ahead", before calling applyCategorization.
- Do not treat a new unrelated request as confirmation.
- If evidence is insufficient, say what is missing and do not write.

Communication:
- Keep responses concise, practical, and display-safe.
- Never reveal private chain-of-thought or internal deliberation.`

export const route: AgentRouteHandler = async (c, next) => {
  const expectedToken = process.env.PENGE_FLUE_INTERNAL_TOKEN
  const authorization = c.req.header('authorization')
  const id = c.req.param('id')
  const trustedUserId = c.req.header('x-penge-user-id')
  const trustedTeamId = c.req.header('x-penge-team-id')
  const scope = id ? decodeTeamDataAssistantId(id) : null

  if (!expectedToken || authorization !== `Bearer ${expectedToken}` || !scope || scope.userId !== trustedUserId || scope.teamId !== trustedTeamId) {
    return c.json({error: 'Not found'}, 404)
  }

  await next()
}

export function createTeamDataAssistantConfig({id}: {id: string}) {
  const scope = decodeTeamDataAssistantId(id)
  if (!scope) throw new Error('Invalid team data assistant id')

  return {
    model: 'openai/gpt-5.4-nano',
    instructions: teamDataAssistantInstructions,
    tools: [
      ...createCategorizationReadTools({appRunId: id, userId: scope.userId, teamId: scope.teamId}),
      ...createChatCategorizationWriteTools({appRunId: id, userId: scope.userId, teamId: scope.teamId}),
    ],
  }
}

export default defineAgent(createTeamDataAssistantConfig)
