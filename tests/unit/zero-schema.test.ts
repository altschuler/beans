import {describe, expect, it} from 'vitest'
import {schema} from '@/zero/schema'

describe('zero schema', () => {
  it('exposes domain tables', () => {
    expect(schema.tables).not.toHaveProperty(['ledgerTransaction', 'Movements'].join(''))
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
      ]),
    )
  })

  it('exposes bank account sync fields with server column names', () => {
    const columns = schema.tables.bankAccounts.columns

    expect(columns.syncStatus).toMatchObject({type: 'string', optional: false, serverName: 'sync_status'})
    expect(columns.syncError).toMatchObject({type: 'string', optional: true, serverName: 'sync_error'})
    expect(columns.syncStartedAt).toMatchObject({type: 'number', optional: true, serverName: 'sync_started_at'})
  })

  it('exposes ledger fields with server column names', () => {
    expect(schema.tables.ledgerAccountGroups.columns.systemKey).toMatchObject({type: 'string', optional: true, serverName: 'system_key'})
    expect(schema.tables.ledgerAccounts.columns.systemKey).toMatchObject({type: 'string', optional: true, serverName: 'system_key'})
    expect(schema.tables.ledgerAccounts.columns.normalBalance).toMatchObject({type: 'string', optional: false, serverName: 'normal_balance'})
    expect(schema.tables.ledgerAccounts.columns.linkedBankAccountId).toMatchObject({type: 'string', optional: true, serverName: 'linked_bank_account_id'})
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('bankTransactionId')
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('aiConfidence')
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('aiProcessingStartedAt')
    expect(schema.tables.ledgerTransactions.columns).not.toHaveProperty('aiReasoning')
    expect(schema.tables.bankTransactions.columns.aiConfidence).toMatchObject({type: 'number', optional: true, serverName: 'ai_confidence'})
    expect(schema.tables.bankTransactions.columns.aiProcessingStartedAt).toMatchObject({type: 'number', optional: true, serverName: 'ai_processing_started_at'})
    expect(schema.tables.bankTransactions.columns.aiReasoning).toMatchObject({type: 'string', optional: true, serverName: 'ai_reasoning'})
    expect(schema.tables.ledgerTransactions.columns.categorizedBy).toMatchObject({type: 'string', optional: true, serverName: 'categorized_by'})
    expect(schema.tables.ledgerTransactions.columns.userConfirmedAt).toMatchObject({type: 'number', optional: true, serverName: 'user_confirmed_at'})
    expect(schema.tables.ledgerTransactions.columns.userConfirmedBy).toMatchObject({type: 'string', optional: true, serverName: 'user_confirmed_by'})
    expect(schema.tables.ledgerPostings.columns.bankTransactionId).toMatchObject({type: 'string', optional: true, serverName: 'bank_transaction_id'})
  })
})
