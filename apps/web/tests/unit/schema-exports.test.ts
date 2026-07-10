import {describe, expect, it} from 'vitest'
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

  it('exports eve runtime cursor columns on app-owned AI tables', () => {
    expect(agentWorkflowRuns.eveSessionId).toBeDefined()
    expect(agentWorkflowRuns.eveNextStreamIndex).toBeDefined()
    expect(teamDataAssistantChats.eveSessionId).toBeDefined()
    expect(teamDataAssistantChats.eveContinuationToken).toBeDefined()
    expect(teamDataAssistantChats.eveNextStreamIndex).toBeDefined()
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
