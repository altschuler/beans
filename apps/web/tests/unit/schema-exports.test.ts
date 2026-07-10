import {describe, expect, it} from 'vitest'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {applyCategorizationsInputSchema, manageCategoryInputSchema, safeChatProposalSchema} from '@penge/domain/eve-chat-approval'
import {
  agentToolExecutions,
  agentWorkflowRuns,
  bankAccounts,
  bankConnections,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerPostings,
  ledgerTransactions,
  teamDataAssistantChatApprovals,
  teamDataAssistantChatEvents,
  teamDataAssistantChats,
  teamMembers,
  teams,
} from '@penge/domain/schema'

describe('banking schema exports', () => {
  it('exports team, workflow, and banking tables', () => {
    expect(teams).toBeDefined()
    expect(teamMembers).toBeDefined()
    expect(agentWorkflowRuns).toBeDefined()
    expect(agentToolExecutions).toBeDefined()
    expect(bankConnections).toBeDefined()
    expect(bankAccounts).toBeDefined()
    expect(bankTransactions).toBeDefined()
  })

  it('exports bank connection institution metadata columns', () => {
    expect(bankConnections.providerInstitutionName).toBeDefined()
    expect(bankConnections.providerInstitutionLogoUrl).toBeDefined()
  })

  it('exports bank account sync status columns', () => {
    expect(bankAccounts.syncStatus).toBeDefined()
    expect(bankAccounts.syncError).toBeDefined()
    expect(bankAccounts.syncStartedAt).toBeDefined()
  })

  it('exports the server-only eve tool execution ledger', () => {
    expect(agentToolExecutions.eveSessionId).toBeDefined()
    expect(agentToolExecutions.callId).toBeDefined()
    expect(agentToolExecutions.result).toBeDefined()
  })

  it('exports checked eve chat runtime coordination and projection tables', () => {
    expect(agentWorkflowRuns.eveSessionId).toBeDefined()
    expect(agentWorkflowRuns.eveNextStreamIndex).toBeDefined()
    expect(teamDataAssistantChats.eveSessionId).toBeDefined()
    expect(teamDataAssistantChats.eveContinuationToken).toBeDefined()
    expect(teamDataAssistantChats.eveSessionOrdinal).toBeDefined()
    expect(teamDataAssistantChats.eveNextStreamIndex).toBeDefined()
    expect(teamDataAssistantChats.eveSessionState).toBeDefined()
    expect(teamDataAssistantChats.eveTurnStartedAt).toBeDefined()
    expect(teamDataAssistantChats.eveAdmissionId).toBeDefined()
    expect(teamDataAssistantChats.eveFollowUpDeliveryState).toBeDefined()
    expect(teamDataAssistantChats.eveFollowUpPreTurnCursor).toBeDefined()
    expect(teamDataAssistantChats).not.toHaveProperty('currentPage')
    expect(teamDataAssistantChatEvents.event).toBeDefined()
    expect(teamDataAssistantChatApprovals.safeProposal).toBeDefined()

    const chatConfig = getTableConfig(teamDataAssistantChats)
    expect(chatConfig.checks.map(item => item.name)).toEqual(expect.arrayContaining([
      'team_data_assistant_chats_eve_session_ordinal_check',
      'team_data_assistant_chats_eve_next_stream_index_check',
      'team_data_assistant_chats_eve_session_state_check',
      'team_data_assistant_chats_eve_follow_up_delivery_state_check',
      'team_data_assistant_chats_eve_follow_up_pre_turn_cursor_check',
      'team_data_assistant_chats_eve_follow_up_delivery_marker_check',
    ]))
    expect(chatConfig.indexes.map(item => item.config.name)).toContain(
      'team_data_assistant_chats_session_state_turn_started_idx',
    )
    expect(teamDataAssistantChats.eveSessionOrdinal.default).toBe(0)
    expect(teamDataAssistantChats.eveSessionState.default).toBe('none')
    expect(teamDataAssistantChats.eveFollowUpDeliveryState.default).toBe('none')

    const eventConfig = getTableConfig(teamDataAssistantChatEvents)
    expect(eventConfig.foreignKeys[0]?.onDelete).toBe('cascade')
    expect(eventConfig.indexes.map(item => item.config.name)).toEqual(expect.arrayContaining([
      'team_data_assistant_chat_events_chat_session_stream_unique',
      'team_data_assistant_chat_events_chat_ordinal_stream_unique',
      'team_data_assistant_chat_events_ordered_idx',
    ]))
    expect(eventConfig.checks.map(item => item.name)).toEqual(expect.arrayContaining([
      'team_data_assistant_chat_events_session_ordinal_check',
      'team_data_assistant_chat_events_stream_index_check',
    ]))

    const approvalConfig = getTableConfig(teamDataAssistantChatApprovals)
    expect(approvalConfig.foreignKeys[0]?.onDelete).toBe('cascade')
    expect(approvalConfig.indexes.map(item => item.config.name)).toContain('team_data_assistant_chat_approvals_chat_session_request_unique')
    expect(approvalConfig.checks.map(item => item.name)).toEqual(expect.arrayContaining([
      'team_data_assistant_chat_approvals_session_ordinal_check',
      'team_data_assistant_chat_approvals_projection_status_check',
      'team_data_assistant_chat_approvals_resolution_status_check',
      'team_data_assistant_chat_approvals_pending_claim_owner_check',
    ]))
    expect(teamDataAssistantChatApprovals.eveClaimedByAdmissionId).toBeDefined()
  })

  it('accepts every safe categorization proposal variant and enforces display bounds', () => {
    const baseItem = {
      date: 'd'.repeat(32),
      amount: -125_000,
      currency: 'C'.repeat(8),
      description: 'Lunch',
      counterpartyName: 'Cafe',
    }
    for (const proposal of [
      {kind: 'category', categoryName: 'N'.repeat(120)},
      {kind: 'split', lines: [{categoryName: 'Meals', amount: 100_000}, {categoryName: 'Tips', amount: 25_000}]},
      {kind: 'transfer', transferAccountName: 'Savings'},
    ]) {
      expect(safeChatProposalSchema.safeParse({
        kind: 'applyCategorizations', itemCount: 1, items: [{...baseItem, proposal}],
      }).success).toBe(true)
    }

    for (const item of [
      {...baseItem, date: 'd'.repeat(33), proposal: {kind: 'category', categoryName: 'Meals'}},
      {...baseItem, currency: 'C'.repeat(9), proposal: {kind: 'category', categoryName: 'Meals'}},
      {...baseItem, proposal: {kind: 'category', categoryName: 'N'.repeat(121)}},
    ]) {
      expect(safeChatProposalSchema.safeParse({kind: 'applyCategorizations', itemCount: 1, items: [item]}).success).toBe(false)
    }
  })

  it('accepts all six safe category-management proposal operations', () => {
    for (const operation of [
      {kind: 'createGroup', newName: 'Spending'},
      {kind: 'updateGroup', currentName: 'Spending', newName: 'Everyday'},
      {kind: 'deleteGroup', currentName: 'Unused'},
      {kind: 'createCategory', newName: 'Meals', description: 'Food away from home', type: 'expense', groupName: 'Everyday'},
      {kind: 'updateCategory', currentName: 'Meals', newName: 'Dining', description: 'Restaurants', type: 'expense', groupName: 'Everyday'},
      {kind: 'deleteCategory', currentName: 'Unused', groupName: 'Everyday'},
    ]) {
      expect(safeChatProposalSchema.safeParse({kind: 'manageCategory', operation}).success).toBe(true)
    }
  })

  it('rejects partial, oversized, or ID-bearing safe projections', () => {
    const categoryItem = {
      date: '2026-07-10', amount: -125_000, currency: 'DKK', description: 'Lunch',
      proposal: {kind: 'category', categoryName: 'Meals'},
    }
    const categoryProposal = {kind: 'applyCategorizations', itemCount: 1, items: [categoryItem]}
    expect(safeChatProposalSchema.safeParse({...categoryProposal, items: Array.from({length: 101}, () => categoryItem)}).success).toBe(false)
    expect(safeChatProposalSchema.safeParse({...categoryProposal, items: [{...categoryItem, description: 'x'.repeat(241)}]}).success).toBe(false)
    expect(safeChatProposalSchema.safeParse({
      kind: 'applyCategorizations', itemCount: 1,
      items: [{...categoryItem, proposal: {kind: 'split', lines: Array.from({length: 51}, () => ({categoryName: 'Meals', amount: 1}))}}],
    }).success).toBe(false)

    const idShaped = structuredClone(categoryProposal) as Record<string, unknown>
    ;(idShaped.items as Array<Record<string, unknown>>)[0]!.bankTransactionId = 'secret-id'
    expect(safeChatProposalSchema.safeParse(idShaped).success).toBe(false)
    expect(safeChatProposalSchema.safeParse({
      kind: 'applyCategorizations', itemCount: 100,
      items: Array.from({length: 100}, () => ({
        ...categoryItem,
        proposal: {kind: 'split', lines: Array.from({length: 50}, () => ({categoryName: 'x'.repeat(120), amount: 1}))},
      })),
    }).success).toBe(false)
  })

  it('preserves exact model-callable chat write semantics independently of projection bounds', () => {
    const categorization = {
      bankTransactionId: 'transaction-1',
      expectedCategorizationRevision: 0,
      interpretation: {kind: 'category', categoryAccountId: 'category-1'},
    }
    expect(applyCategorizationsInputSchema.safeParse({categorizations: Array.from({length: 101}, () => categorization)}).success).toBe(true)
    expect(applyCategorizationsInputSchema.safeParse({
      categorizations: [{
        ...categorization,
        interpretation: {kind: 'split', lines: Array.from({length: 51}, () => ({categoryAccountId: 'category-1', amount: '1'}))},
      }],
    }).success).toBe(true)
    expect(manageCategoryInputSchema.safeParse({operation: {
      kind: 'createCategory', groupId: 'group-1', name: 'x'.repeat(121), description: 'd'.repeat(241), type: 'expense',
    }}).success).toBe(true)
  })

  it('exports ledger tables', () => {
    expect(ledgerAccountGroups).toBeDefined()
    expect(ledgerAccounts).toBeDefined()
    expect(ledgerTransactions).toBeDefined()
    expect(ledgerPostings).toBeDefined()
  })

  it('exports ledger account and posting columns', () => {
    expect(ledgerAccounts.systemKey).toBeDefined()
    expect(ledgerAccounts.linkedBankAccountId).toBeDefined()
    expect(ledgerAccounts.normalBalance).toBeDefined()
    expect(ledgerTransactions).not.toHaveProperty('bankTransactionId')
    expect(ledgerTransactions).not.toHaveProperty('aiConfidence')
    expect(ledgerTransactions).not.toHaveProperty('aiReasoning')
    expect(bankTransactions.aiConfidence).toBeDefined()
    expect(bankTransactions.aiReasoning).toBeDefined()
    expect(ledgerTransactions.categorizedBy).toBeDefined()
    expect(ledgerTransactions.userConfirmedAt).toBeDefined()
    expect(ledgerTransactions.userConfirmedBy).toBeDefined()
    expect(ledgerPostings.ledgerTransactionId).toBeDefined()
    expect(ledgerPostings.accountId).toBeDefined()
    expect(ledgerPostings.amount).toBeDefined()
    expect(ledgerPostings.currency).toBeDefined()
    expect(ledgerPostings.bankTransactionId).toBeDefined()
  })
})
