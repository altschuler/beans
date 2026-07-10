import {describe, expect, it} from 'vitest'
import {schema} from '@/zero/schema'

describe('zero schema', () => {
  it('exposes domain tables', () => {
    expect(Object.keys(schema.tables)).toEqual(
      expect.arrayContaining([
        'teams',
        'teamMembers',
        'bankConnections',
        'bankAccounts',
        'bankTransactions',
        'ledgerAccountGroups',
        'ledgerAccounts',
        'ledgerTransactions',
        'ledgerPostings',
        'agentWorkflowRuns',
        'teamDataAssistantChats',
        'teamDataAssistantChatEvents',
        'teamDataAssistantChatApprovals',
      ]),
    )
  })

  it('excludes Better Auth and eve tool execution tables from the synced schema', () => {
    for (const authTable of ['user', 'session', 'account', 'verification', 'agentToolExecutions']) {
      expect(schema.tables).not.toHaveProperty(authTable)
    }
  })

  it('excludes server-only bank transaction provider payloads from the synced schema', () => {
    expect(schema.tables.bankTransactions.columns).not.toHaveProperty('raw')
  })

  it('exposes bank connection institution metadata fields with server column names', () => {
    const columns = schema.tables.bankConnections.columns

    expect(columns.providerInstitutionName).toMatchObject({type: 'string', optional: true, serverName: 'provider_institution_name'})
    expect(columns.providerInstitutionLogoUrl).toMatchObject({type: 'string', optional: true, serverName: 'provider_institution_logo_url'})
  })

  it('exposes bank account sync fields with server column names', () => {
    const columns = schema.tables.bankAccounts.columns

    expect(columns.syncStatus).toMatchObject({type: 'string', optional: false, serverName: 'sync_status'})
    expect(columns.syncError).toMatchObject({type: 'string', optional: true, serverName: 'sync_error'})
    expect(columns.syncStartedAt).toMatchObject({type: 'number', optional: true, serverName: 'sync_started_at'})
  })

  it('exposes workflow run fields with server column names', () => {
    expect(schema.tables.agentWorkflowRuns.columns).not.toHaveProperty('flueRunId')
    expect(schema.tables.agentWorkflowRuns.columns.workflowName).toMatchObject({type: 'string', optional: false, serverName: 'workflow_name'})
    expect(schema.tables.agentWorkflowRuns.columns.teamId).toMatchObject({type: 'string', optional: false, serverName: 'team_id'})
    expect(schema.tables.agentWorkflowRuns.columns.requestedByUserId).toMatchObject({
      type: 'string',
      optional: false,
      serverName: 'requested_by_user_id',
    })
    expect(schema.tables.agentWorkflowRuns.columns.status).toMatchObject({type: 'string', optional: false})
    expect(schema.tables.agentWorkflowRuns.columns.error).toMatchObject({type: 'string', optional: true})
    expect(schema.tables.agentWorkflowRuns.columns.finishedAt).toMatchObject({type: 'number', optional: true, serverName: 'finished_at'})
    expect(schema.tables.agentWorkflowRuns.columns).not.toHaveProperty('eveSessionId')
    expect(schema.tables.agentWorkflowRuns.columns).not.toHaveProperty('eveNextStreamIndex')
  })

  it('exposes team data assistant chat fields with server column names', () => {
    const columns = schema.tables.teamDataAssistantChats.columns

    expect(columns.teamId).toMatchObject({type: 'string', optional: false, serverName: 'team_id'})
    expect(columns.userId).toMatchObject({type: 'string', optional: false, serverName: 'user_id'})
    expect(columns.lastUsedAt).toMatchObject({type: 'number', optional: false, serverName: 'last_used_at'})
    expect(columns.firstSubmittedAt).toMatchObject({type: 'number', optional: true, serverName: 'first_submitted_at'})
    expect(columns).not.toHaveProperty('eveSessionId')
    expect(columns).not.toHaveProperty('eveContinuationToken')
    expect(columns).not.toHaveProperty('eveSessionOrdinal')
    expect(columns).not.toHaveProperty('eveNextStreamIndex')
    expect(columns).not.toHaveProperty('eveSessionState')
    expect(columns).not.toHaveProperty('eveTurnStartedAt')
    expect(columns).not.toHaveProperty('eveAdmissionId')
    expect(columns).not.toHaveProperty('eveFollowUpDeliveryState')
    expect(columns).not.toHaveProperty('eveFollowUpPreTurnCursor')
    expect(columns).not.toHaveProperty('currentPage')
  })

  it('exposes exact safe event and approval projections', () => {
    expect(Object.keys(schema.tables.teamDataAssistantChatEvents.columns)).toEqual([
      'id',
      'chatId',
      'sessionOrdinal',
      'streamIndex',
      'type',
      'event',
      'occurredAt',
    ])
    expect(Object.keys(schema.tables.teamDataAssistantChatApprovals.columns)).toEqual([
      'id',
      'chatId',
      'sessionOrdinal',
      'requestId',
      'callId',
      'toolName',
      'safeProposal',
      'projectionStatus',
      'resolutionStatus',
    ])
    expect(schema.tables.teamDataAssistantChatEvents.columns).not.toHaveProperty('eveSessionId')
    expect(schema.tables.teamDataAssistantChatEvents.columns).not.toHaveProperty('createdAt')
    expect(schema.tables.teamDataAssistantChatApprovals.columns).not.toHaveProperty('eveSessionId')
    expect(schema.tables.teamDataAssistantChatApprovals.columns).not.toHaveProperty('eveClaimedByAdmissionId')
  })

  it('exposes ledger fields with server column names', () => {
    expect(schema.tables.ledgerAccountGroups.columns.systemKey).toMatchObject({type: 'string', optional: true, serverName: 'system_key'})
    expect(schema.tables.ledgerAccounts.columns.systemKey).toMatchObject({type: 'string', optional: true, serverName: 'system_key'})
    expect(schema.tables.ledgerAccounts.columns.normalBalance).toMatchObject({type: 'string', optional: false, serverName: 'normal_balance'})
    expect(schema.tables.ledgerAccounts.columns.linkedBankAccountId).toMatchObject({type: 'string', optional: true, serverName: 'linked_bank_account_id'})
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('bankTransactionId')
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('aiConfidence')
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('aiReasoning')
    expect(schema.tables.bankTransactions.columns.amount).toMatchObject({type: 'number', optional: false})
    expect(schema.tables.bankTransactions.columns.aiConfidence).toMatchObject({type: 'number', optional: true, serverName: 'ai_confidence'})
    expect(schema.tables.bankTransactions.columns.aiReasoning).toMatchObject({type: 'string', optional: true, serverName: 'ai_reasoning'})
    expect(schema.tables.ledgerTransactions.columns.categorizedBy).toMatchObject({type: 'string', optional: true, serverName: 'categorized_by'})
    expect(schema.tables.ledgerTransactions.columns.userConfirmedAt).toMatchObject({type: 'number', optional: true, serverName: 'user_confirmed_at'})
    expect(schema.tables.ledgerTransactions.columns.userConfirmedBy).toMatchObject({type: 'string', optional: true, serverName: 'user_confirmed_by'})
    expect(schema.tables.ledgerPostings.columns.amount).toMatchObject({type: 'number', optional: false})
    expect(schema.tables.ledgerPostings.columns.bankTransactionId).toMatchObject({type: 'string', optional: true, serverName: 'bank_transaction_id'})
  })
})
