import {describe, expect, it} from 'vitest'
import {schema} from '@/zero/schema'

describe('Zero schema', () => {
  it('syncs chat list metadata but excludes runtime handles and transcript state', () => {
    expect(schema.tables).toHaveProperty('teamDataAssistantChats')
    expect(schema.tables.teamDataAssistantChats.columns).not.toHaveProperty('eveSessionId')
    expect(schema.tables.teamDataAssistantChats.columns).not.toHaveProperty('eveContinuationToken')
    expect(schema.tables).not.toHaveProperty('teamDataAssistantChatEvents')
    expect(schema.tables).not.toHaveProperty('teamDataAssistantChatApprovals')
    expect(schema.tables).not.toHaveProperty('agentWorkflowRuns')
  })
})
