import {describe, expect, it} from 'vitest'
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerTransactionMovements,
  ledgerTransactions,
  teamMembers,
  teams,
} from '@/db/schema'

describe('banking schema exports', () => {
  it('exports team and banking tables', () => {
    expect(teams).toBeDefined()
    expect(teamMembers).toBeDefined()
    expect(bankConnections).toBeDefined()
    expect(bankAccounts).toBeDefined()
    expect(bankTransactions).toBeDefined()
  })

  it('exports bank account sync status columns', () => {
    expect(bankAccounts.syncStatus).toBeDefined()
    expect(bankAccounts.syncError).toBeDefined()
    expect(bankAccounts.syncStartedAt).toBeDefined()
  })

  it('exports ledger tables', () => {
    expect(ledgerAccountGroups).toBeDefined()
    expect(ledgerAccounts).toBeDefined()
    expect(ledgerTransactions).toBeDefined()
    expect(ledgerTransactionMovements).toBeDefined()
  })

  it('exports ledger account and movement columns', () => {
    expect(ledgerAccounts.systemKey).toBeDefined()
    expect(ledgerAccounts.linkedBankAccountId).toBeDefined()
    expect(ledgerAccounts.normalBalance).toBeDefined()
    expect(ledgerTransactions.bankTransactionId).toBeDefined()
    expect(ledgerTransactions.aiConfidence).toBeDefined()
    expect(ledgerTransactions.aiProcessingStartedAt).toBeDefined()
    expect(ledgerTransactionMovements.debitAccountId).toBeDefined()
    expect(ledgerTransactionMovements.creditAccountId).toBeDefined()
  })
})
