import {describe, expect, it} from 'vitest'
import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerPostings,
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
    expect(ledgerPostings).toBeDefined()
  })

  it('exports ledger account and posting columns', () => {
    expect(ledgerAccounts.systemKey).toBeDefined()
    expect(ledgerAccounts.linkedBankAccountId).toBeDefined()
    expect(ledgerAccounts.normalBalance).toBeDefined()
    expect(ledgerTransactions).not.toHaveProperty('bankTransactionId')
    expect(ledgerTransactions.aiConfidence).toBeDefined()
    expect(ledgerTransactions.aiProcessingStartedAt).toBeDefined()
    expect(ledgerTransactions.categorizedBy).toBeDefined()
    expect(ledgerTransactions.userConfirmedAt).toBeDefined()
    expect(ledgerTransactions.userConfirmedBy).toBeDefined()
    expect(ledgerTransactions.aiReasoning).toBeDefined()
    expect(ledgerPostings.ledgerTransactionId).toBeDefined()
    expect(ledgerPostings.accountId).toBeDefined()
    expect(ledgerPostings.amount).toBeDefined()
    expect(ledgerPostings.currency).toBeDefined()
    expect(ledgerPostings.bankTransactionId).toBeDefined()
  })
})
