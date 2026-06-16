import {describe, expect, it} from 'vitest'
import {bankAccounts, bankConnections, bankTransactions, teamMembers, teams} from '@/db/schema'

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
})
