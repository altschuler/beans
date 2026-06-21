import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {bankAccounts, bankConnections, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers, teams, user} from '@/db/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'

const baseNow = new Date('2026-06-21T10:00:00.000Z')

async function seedFixture() {
  await db.insert(user).values([
    {id: 'user-1', name: 'User One', email: 'one@example.com', emailVerified: true, image: null, createdAt: baseNow, updatedAt: baseNow},
    {id: 'user-2', name: 'User Two', email: 'two@example.com', emailVerified: true, image: null, createdAt: baseNow, updatedAt: baseNow},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team One', personalOwnerUserId: 'user-1', createdAt: baseNow, updatedAt: baseNow},
    {id: 'team-2', name: 'Team Two', personalOwnerUserId: 'user-2', createdAt: baseNow, updatedAt: baseNow},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: baseNow, updatedAt: baseNow},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: baseNow, updatedAt: baseNow},
  ])
  await db.insert(bankConnections).values({
    id: 'bank-connection-1',
    teamId: 'team-1',
    provider: 'test',
    providerInstitutionId: 'institution-1',
    providerRequisitionId: 'requisition-1',
    reference: 'reference-1',
    status: 'linked',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(bankAccounts).values({
    id: 'bank-account-1',
    teamId: 'team-1',
    bankConnectionId: 'bank-connection-1',
    provider: 'test',
    providerInstitutionId: 'institution-1',
    providerRequisitionId: 'requisition-1',
    providerAccountId: 'provider-account-1',
    name: 'Checking',
    iban: null,
    currency: 'DKK',
    status: 'active',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerAccountGroups).values([
    {id: 'bank-group', teamId: 'team-1', systemKey: 'bank_accounts', name: 'Bank accounts', sortOrder: 0, createdAt: baseNow, updatedAt: baseNow},
    {id: 'system-group', teamId: 'team-1', systemKey: 'system_accounts', name: 'System accounts', sortOrder: 1, createdAt: baseNow, updatedAt: baseNow},
    {id: 'spending-group', teamId: 'team-1', systemKey: null, name: 'Everyday spending', sortOrder: 2, createdAt: baseNow, updatedAt: baseNow},
    {id: 'empty-group', teamId: 'team-1', systemKey: null, name: 'Empty group', sortOrder: 3, createdAt: baseNow, updatedAt: baseNow},
    {id: 'other-group', teamId: 'team-2', systemKey: null, name: 'Other group', sortOrder: 0, createdAt: baseNow, updatedAt: baseNow},
  ])
  await db.insert(ledgerAccounts).values([
    account('system-account', 'team-1', 'system-group', 'adjustment', 'Uncategorized', {systemKey: 'uncategorized'}),
    account('bank-account-ledger', 'team-1', 'spending-group', 'bank', 'Checking', {linkedBankAccountId: 'bank-account-1', normalBalance: 'debit'}),
    account('groceries', 'team-1', 'spending-group', 'expense', 'Groceries'),
    account('unused-income', 'team-1', 'spending-group', 'income', 'Unused income'),
    account('other-team-category', 'team-2', 'other-group', 'expense', 'Other team category'),
  ])
  await db.insert(ledgerTransactions).values({
    id: 'ledger-transaction-1',
    teamId: 'team-1',
    source: 'manual',
    status: 'confirmed',
    categorizedBy: 'user',
    userConfirmedAt: baseNow,
    userConfirmedBy: 'user-1',
    date: '2026-06-21',
    description: 'Existing history',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerPostings).values({
    id: 'posting-groceries',
    ledgerTransactionId: 'ledger-transaction-1',
    accountId: 'groceries',
    amount: '10.0000',
    currency: 'DKK',
    bankTransactionId: null,
    sortOrder: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

function account(
  id: string,
  teamId: string,
  groupId: string,
  type: string,
  name: string,
  options: {systemKey?: string | null; linkedBankAccountId?: string | null; normalBalance?: string} = {},
) {
  return {
    id,
    teamId,
    groupId,
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: options.systemKey ?? null,
    type,
    normalBalance: options.normalBalance ?? 'credit',
    name,
    description: '',
    status: 'active',
    sortOrder: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  }
}

describe('category management server functions', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedFixture()
  })
  afterAll(async () => closeDatabase())

  it('creates, updates, and deletes an unused category account', async () => {
    const {createCategoryAccount, updateCategoryAccount, deleteCategoryAccount} = await import('@/ledger/category-management.server')

    await db.transaction(tx => createCategoryAccount(tx, {
      userId: 'user-1',
      id: 'new-category',
      teamId: 'team-1',
      groupId: 'spending-group',
      name: '  Pets  ',
      description: '  Food and vet visits  ',
      type: 'expense',
    }))

    await expect(db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, 'new-category'))).resolves.toMatchObject([
      {teamId: 'team-1', groupId: 'spending-group', name: 'Pets', description: 'Food and vet visits', type: 'expense', normalBalance: 'credit', systemKey: null, linkedBankAccountId: null},
    ])

    await db.transaction(tx => updateCategoryAccount(tx, {
      userId: 'user-1',
      accountId: 'new-category',
      groupId: 'empty-group',
      name: 'Pet care',
      description: '',
      type: 'savings',
    }))

    await expect(db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, 'new-category'))).resolves.toMatchObject([
      {groupId: 'empty-group', name: 'Pet care', description: '', type: 'savings'},
    ])

    await db.transaction(tx => deleteCategoryAccount(tx, {userId: 'user-1', accountId: 'new-category'}))
    await expect(db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, 'new-category'))).resolves.toHaveLength(0)
  })

  it('creates, updates, and deletes an empty category group', async () => {
    const {createCategoryGroup, updateCategoryGroup, deleteCategoryGroup} = await import('@/ledger/category-management.server')

    await db.transaction(tx => createCategoryGroup(tx, {userId: 'user-1', id: 'new-group', teamId: 'team-1', name: '  Pets  '}))
    await expect(db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, 'new-group'))).resolves.toMatchObject([
      {teamId: 'team-1', systemKey: null, name: 'Pets'},
    ])

    await db.transaction(tx => updateCategoryGroup(tx, {userId: 'user-1', groupId: 'new-group', name: 'Pet care'}))
    await expect(db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, 'new-group'))).resolves.toMatchObject([{name: 'Pet care'}])

    await db.transaction(tx => deleteCategoryGroup(tx, {userId: 'user-1', groupId: 'new-group'}))
    await expect(db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, 'new-group'))).resolves.toHaveLength(0)
  })

  it.each([
    ['system account', 'system-account', 'System accounts cannot be edited'],
    ['bank account', 'bank-account-ledger', 'Bank-linked accounts cannot be edited'],
    ['other team account', 'other-team-category', 'Category account not found'],
  ])('rejects updating %s', async (_label, accountId, message) => {
    const {updateCategoryAccount} = await import('@/ledger/category-management.server')

    await expect(db.transaction(tx => updateCategoryAccount(tx, {
      userId: 'user-1',
      accountId,
      groupId: 'spending-group',
      name: 'Blocked',
      description: '',
      type: 'expense',
    }))).rejects.toThrow(message)
  })

  it('rejects category deletion when postings exist', async () => {
    const {deleteCategoryAccount} = await import('@/ledger/category-management.server')

    await expect(db.transaction(tx => deleteCategoryAccount(tx, {userId: 'user-1', accountId: 'groceries'}))).rejects.toThrow('Categories with ledger history cannot be deleted')
  })

  it('rejects system and non-empty group changes', async () => {
    const {updateCategoryGroup, deleteCategoryGroup} = await import('@/ledger/category-management.server')

    await expect(db.transaction(tx => updateCategoryGroup(tx, {userId: 'user-1', groupId: 'system-group', name: 'Blocked'}))).rejects.toThrow('System groups cannot be edited')
    await expect(db.transaction(tx => deleteCategoryGroup(tx, {userId: 'user-1', groupId: 'spending-group'}))).rejects.toThrow('Move or delete categories in this group first')
  })

  it('rejects creating categories in locked or inaccessible groups', async () => {
    const {createCategoryAccount} = await import('@/ledger/category-management.server')

    await expect(db.transaction(tx => createCategoryAccount(tx, {
      userId: 'user-1',
      id: 'blocked-system-group',
      teamId: 'team-1',
      groupId: 'system-group',
      name: 'Blocked',
      description: '',
      type: 'expense',
    }))).rejects.toThrow('System groups cannot contain user categories')

    await expect(db.transaction(tx => createCategoryAccount(tx, {
      userId: 'user-1',
      id: 'blocked-bank-group',
      teamId: 'team-1',
      groupId: 'bank-group',
      name: 'Blocked',
      description: '',
      type: 'expense',
    }))).rejects.toThrow('System groups cannot contain user categories')

    await expect(db.transaction(tx => createCategoryAccount(tx, {
      userId: 'user-1',
      id: 'blocked-other-team',
      teamId: 'team-1',
      groupId: 'other-group',
      name: 'Blocked',
      description: '',
      type: 'expense',
    }))).rejects.toThrow('Category group not found')
  })
})
