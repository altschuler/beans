import {describe, expect, it} from 'vitest'
import * as schema from '@penge/domain/schema'

describe('domain schema exports', () => {
  it('keeps only the chat identity and server-side Eve handles', () => {
    expect(schema.teamDataAssistantChats.eveSessionId).toBeDefined()
    expect(schema.teamDataAssistantChats.eveContinuationToken).toBeDefined()
    expect(schema.teamDataAssistantChats).not.toHaveProperty('eveSessionOrdinal')
    expect(schema.teamDataAssistantChats).not.toHaveProperty('eveNextStreamIndex')
    expect(schema.teamDataAssistantChats).not.toHaveProperty('eveSessionState')
  })

  it('drops workflow-run and chat projection tables while keeping the tool execution ledger', () => {
    expect(schema).not.toHaveProperty('agentWorkflowRuns')
    expect(schema).not.toHaveProperty('teamDataAssistantChatEvents')
    expect(schema).not.toHaveProperty('teamDataAssistantChatApprovals')
    expect(schema.agentToolExecutions).toBeDefined()
  })
})
