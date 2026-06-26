import {defineAgent, type AgentRouteHandler} from '@flue/runtime'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {createCategorizationReadTools} from '../agent-tools/read-tools'
import {createChatCategorizationWriteTools, createChatCategoryManagementWriteTools} from '../agent-tools/write-tools'

export const description = 'Answers questions about scoped team finance data and can apply confirmed categorization and category-management changes.'

export const teamDataAssistantInstructions = `You are Penge's team data assistant.

Scope and safety:
- Use only the trusted team and user scope encoded in this agent instance.
- Never ask the user for user ids, team ids, or unrestricted database filters.
- Use available read tools to inspect transactions, categories, category groups, bank accounts, and prior examples before answering.
- You may discuss and manage editable categories and category groups, but never edit bank-linked accounts, system accounts, or system groups.

Writes:
- You may apply categorization changes supported by the chat write tool: category, split, or transfer.
- You may apply category or category group management changes supported by the chat write tool: create, rename/update, move, or delete.
- Before any write, state a concrete proposal that names the transaction, category, or category group and the exact change you intend to apply.
- Treat an initial user request to create, update, delete, apply, categorize, or otherwise change data as a request for a proposal, not as permission to write.
- After stating the proposal, ask an explicit permission question and wait for a separate confirming user reply with natural confirmation, such as "yes", "sounds good", or "go ahead", before calling applyCategorization or manageCategory.
- Do not treat a new unrelated request as confirmation.
- If evidence is insufficient, say what is missing and do not write.
- If a category-management write fails, report the failure, re-read the relevant categories or category groups before proposing a follow-up, and stop remaining category-management operations from the failed proposal.

Communication:
- Keep responses concise, practical, and display-safe.
- Never show internal ids, UUIDs, run ids, database ids, account ids, category ids, group ids, transaction ids, or tool-only identifiers to the user. Use user-facing names, dates, amounts, descriptions, and summaries instead.
- You may use ids internally for tool calls, but final and intermediate chat responses must not include them unless the user explicitly asks for technical/debug details.
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
      ...createChatCategoryManagementWriteTools({appRunId: id, userId: scope.userId, teamId: scope.teamId}),
    ],
  }
}

export default defineAgent(createTeamDataAssistantConfig)
