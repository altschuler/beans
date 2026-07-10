import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {db} from '@/db/client'
import {resolveChatApprovalProposal} from '@penge/domain/chat-approval-proposals'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  teamMembers,
  teams,
  user,
} from '@penge/domain/schema'

const now = new Date('2026-07-10T12:00:00.000Z')
const scope = {teamId: 'team-1', userId: 'user-1'}

beforeAll(() => migrateDatabase())
beforeEach(async () => {
  await resetDatabase()
  await seedDisplayData()
})
afterAll(() => closeDatabase())

describe('safe chat approval proposal resolution', () => {
  it('resolves category, split, and transfer proposals using only trusted-team display data', async () => {
    const cases = [
      {
        interpretation: {kind: 'category', categoryAccountId: 'category-1'},
        proposal: {kind: 'category', categoryName: 'Groceries'},
      },
      {
        interpretation: {kind: 'split', lines: [
          {categoryAccountId: 'category-1', amount: '12.3400'},
          {categoryAccountId: 'category-2', amount: '7.66'},
        ]},
        proposal: {kind: 'split', lines: [
          {categoryName: 'Groceries', amount: 123400},
          {categoryName: 'Transport', amount: 76600},
        ]},
      },
      {
        interpretation: {kind: 'transfer', transferLedgerAccountId: 'bank-ledger-2'},
        proposal: {kind: 'transfer', transferAccountName: 'Savings account'},
      },
    ] as const

    for (const testCase of cases) {
      const result = await resolveChatApprovalProposal(db, {
        scope,
        toolName: 'applyCategorizations',
        input: {
          categorizations: [{bankTransactionId: 'transaction-1', expectedCategorizationRevision: 0, interpretation: testCase.interpretation}],
        },
      })
      expect(result).toEqual({
        status: 'ready',
        proposal: {
          kind: 'applyCategorizations',
          itemCount: 1,
          items: [{
            date: '2026-07-09', amount: -200000, currency: 'DKK', description: 'Market purchase',
            counterpartyName: 'Corner Market', proposal: testCase.proposal,
          }],
        },
      })
      expect(JSON.stringify(result)).not.toMatch(/transaction-1|category-1|bank-ledger-2|team-1|user-1/)
    }
  })

  it.each([
    [{kind: 'createGroup', name: 'New group'}, {kind: 'createGroup', newName: 'New group'}],
    [{kind: 'updateGroup', groupId: 'group-1', expectedName: 'Everyday', name: 'Renamed'}, {kind: 'updateGroup', currentName: 'Everyday', newName: 'Renamed'}],
    [{kind: 'deleteGroup', groupId: 'group-empty', expectedName: 'Empty'}, {kind: 'deleteGroup', currentName: 'Empty'}],
    [{kind: 'createCategory', groupId: 'group-1', name: 'Coffee', description: 'Cafes', type: 'expense'},
      {kind: 'createCategory', newName: 'Coffee', description: 'Cafes', type: 'expense', groupName: 'Everyday'}],
    [{kind: 'updateCategory', accountId: 'category-1', expectedName: 'Groceries', groupId: 'group-2', name: 'Food', description: 'Food shops', type: 'expense'},
      {kind: 'updateCategory', currentName: 'Groceries', newName: 'Food', description: 'Food shops', type: 'expense', groupName: 'Other'}],
    [{kind: 'deleteCategory', accountId: 'category-1', expectedName: 'Groceries'},
      {kind: 'deleteCategory', currentName: 'Groceries', groupName: 'Everyday'}],
  ] as const)('resolves the complete manageCategory operation union without IDs: %j', async (operation, expected) => {
    const result = await resolveChatApprovalProposal(db, {scope, toolName: 'manageCategory', input: {operation}})
    expect(result).toEqual({status: 'ready', proposal: {kind: 'manageCategory', operation: expected}})
    expect(JSON.stringify(result)).not.toMatch(/group-1|group-2|category-1|team-1|user-1/)
  })

  it.each([
    {kind: 'updateGroup', groupId: 'group-1', expectedName: 'Stale group', name: 'Renamed'},
    {kind: 'deleteGroup', groupId: 'group-empty', expectedName: 'Stale group'},
    {kind: 'updateCategory', accountId: 'category-1', expectedName: 'Stale category', groupId: 'group-2', name: 'Food', description: '', type: 'expense'},
    {kind: 'deleteCategory', accountId: 'category-1', expectedName: 'Stale category'},
  ])('blocks a manageCategory proposal whose approved name no longer matches: $kind', async operation => {
    await expect(resolveChatApprovalProposal(db, {
      scope,
      toolName: 'manageCategory',
      input: {operation},
    })).resolves.toEqual({status: 'blocked'})
  })

  it('blocks non-exact, out-of-scope, unsupported, and over-bound proposals instead of truncating', async () => {
    const valid = {categorizations: [{
      bankTransactionId: 'transaction-1', expectedCategorizationRevision: 0,
      interpretation: {kind: 'category', categoryAccountId: 'category-1'},
    }]}
    const inputs = [
      {toolName: 'applyCategorizations', input: {...valid, injected: true}},
      {toolName: 'applyCategorizations', input: {categorizations: [{...valid.categorizations[0], bankTransactionId: 'foreign-transaction'}]}},
      {toolName: 'applyCategorizations', input: {categorizations: [{...valid.categorizations[0], interpretation: {kind: 'category', categoryAccountId: 'foreign-category'}}]}},
      {toolName: 'applyCategorizations', input: {categorizations: Array.from({length: 101}, () => valid.categorizations[0])}},
      {toolName: 'applyCategorizations', input: {categorizations: [{...valid.categorizations[0], interpretation: {kind: 'split', lines: Array.from({length: 51}, () => ({categoryAccountId: 'category-1', amount: '1'}))}}]}},
      {toolName: 'applyCategorizations', input: {categorizations: Array.from({length: 100}, () => ({
        ...valid.categorizations[0],
        interpretation: {kind: 'split', lines: Array.from({length: 50}, () => ({categoryAccountId: 'category-1', amount: '1'}))},
      }))}},
      {toolName: 'manageCategory', input: {operation: {kind: 'createGroup', name: 'x'.repeat(121)}}},
      {toolName: 'futureTool', input: valid},
    ]

    for (const input of inputs) {
      await expect(resolveChatApprovalProposal(db, {scope, ...input} as never)).resolves.toEqual({status: 'blocked'})
    }
  })
})

async function seedDisplayData() {
  await db.insert(user).values({id: 'user-1', name: 'User', email: 'user@example.com', emailVerified: true, createdAt: now, updatedAt: now})
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team One', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Team Two', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values({id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now})
  await db.insert(ledgerAccountGroups).values([
    {id: 'group-1', teamId: 'team-1', systemKey: null, name: 'Everyday', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-1', systemKey: null, name: 'Other', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'group-empty', teamId: 'team-1', systemKey: null, name: 'Empty', sortOrder: 2, createdAt: now, updatedAt: now},
    {id: 'foreign-group', teamId: 'team-2', systemKey: null, name: 'Foreign', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    {id: 'bank-1', teamId: 'team-1', provider: 'test', providerInstitutionId: 'i', providerRequisitionId: 'r1', providerAccountId: 'a1', name: 'Current account', currency: 'DKK', status: 'active', syncStatus: 'idle', createdAt: now, updatedAt: now},
    {id: 'bank-2', teamId: 'team-1', provider: 'test', providerInstitutionId: 'i', providerRequisitionId: 'r2', providerAccountId: 'a2', name: 'Savings account', currency: 'DKK', status: 'active', syncStatus: 'idle', createdAt: now, updatedAt: now},
    {id: 'foreign-bank', teamId: 'team-2', provider: 'test', providerInstitutionId: 'i', providerRequisitionId: 'r3', providerAccountId: 'a3', name: 'Foreign bank', currency: 'DKK', status: 'active', syncStatus: 'idle', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccounts).values([
    {id: 'category-1', teamId: 'team-1', groupId: 'group-1', type: 'expense', normalBalance: 'credit', name: 'Groceries', description: '', status: 'active', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'category-2', teamId: 'team-1', groupId: 'group-1', type: 'expense', normalBalance: 'credit', name: 'Transport', description: '', status: 'active', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'bank-ledger-1', teamId: 'team-1', groupId: 'group-2', linkedBankAccountId: 'bank-1', type: 'bank', normalBalance: 'debit', name: 'Current account', description: '', status: 'active', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'bank-ledger-2', teamId: 'team-1', groupId: 'group-2', linkedBankAccountId: 'bank-2', type: 'bank', normalBalance: 'debit', name: 'Savings account', description: '', status: 'active', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'foreign-category', teamId: 'team-2', groupId: 'foreign-group', type: 'expense', normalBalance: 'credit', name: 'Foreign category', description: '', status: 'active', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankTransactions).values([
    {id: 'transaction-1', bankAccountId: 'bank-1', providerTransactionId: 't1', status: 'booked', bookingDate: '2026-07-09', amount: -200000, currency: 'DKK', description: 'Market purchase', counterpartyName: 'Corner Market', raw: {}, createdAt: now, updatedAt: now},
    {id: 'foreign-transaction', bankAccountId: 'foreign-bank', providerTransactionId: 't2', status: 'booked', bookingDate: '2026-07-09', amount: -1, currency: 'DKK', description: 'Foreign', raw: {}, createdAt: now, updatedAt: now},
  ])
}
