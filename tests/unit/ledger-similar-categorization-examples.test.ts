import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerPostings,
  ledgerTransactions,
  teamMembers,
  teams,
  user,
} from '@/db/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'

async function seedFixture() {
  const now = new Date('2026-06-19T10:00:00.000Z')
  await db.insert(user).values({id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now})
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other team', personalOwnerUserId: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccountGroups).values([
    {id: 'bank-group', teamId: 'team-1', name: 'Bank accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'spending-group', teamId: 'team-1', name: 'Everyday spending', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'system-group', teamId: 'team-1', name: 'System', sortOrder: 2, createdAt: now, updatedAt: now},
    {id: 'team-2-bank-group', teamId: 'team-2', name: 'Bank accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'team-2-spending-group', teamId: 'team-2', name: 'Everyday spending', sortOrder: 1, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    {
      id: 'bank-account-1',
      teamId: 'team-1',
      bankConnectionId: null,
      provider: 'gocardless',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      providerAccountId: 'provider-account-1',
      name: 'Checking',
      iban: null,
      currency: 'DKK',
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'team-2-bank-account',
      teamId: 'team-2',
      bankConnectionId: null,
      provider: 'gocardless',
      providerInstitutionId: 'institution-2',
      providerRequisitionId: 'requisition-2',
      providerAccountId: 'provider-account-2',
      name: 'Other checking',
      iban: null,
      currency: 'DKK',
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(ledgerAccounts).values([
    {id: 'bank-ledger-account', teamId: 'team-1', groupId: 'bank-group', linkedBankAccountId: 'bank-account-1', systemKey: null, type: 'bank', normalBalance: 'debit', name: 'Checking', description: '', status: 'active', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'groceries', teamId: 'team-1', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'expense', normalBalance: 'credit', name: 'Groceries', description: 'Supermarkets', status: 'active', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'household', teamId: 'team-1', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'expense', normalBalance: 'credit', name: 'Household', description: 'Home goods', status: 'active', sortOrder: 2, createdAt: now, updatedAt: now},
    {id: 'uncategorized', teamId: 'team-1', groupId: 'system-group', linkedBankAccountId: null, systemKey: 'uncategorized', type: 'adjustment', normalBalance: 'credit', name: 'Uncategorized', description: '', status: 'active', sortOrder: 3, createdAt: now, updatedAt: now},
    {id: 'archived-category', teamId: 'team-1', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'expense', normalBalance: 'credit', name: 'Archived', description: '', status: 'archived', sortOrder: 4, createdAt: now, updatedAt: now},
    {id: 'team-2-bank-ledger-account', teamId: 'team-2', groupId: 'team-2-bank-group', linkedBankAccountId: 'team-2-bank-account', systemKey: null, type: 'bank', normalBalance: 'debit', name: 'Other checking', description: '', status: 'active', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'team-2-groceries', teamId: 'team-2', groupId: 'team-2-spending-group', linkedBankAccountId: null, systemKey: null, type: 'expense', normalBalance: 'credit', name: 'Other groceries', description: '', status: 'active', sortOrder: 1, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankTransactions).values([
    {id: 'target-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'target-bank', status: 'booked', bookingDate: '2026-06-19', valueDate: null, amount: '-100.00', currency: 'DKK', description: 'NETTO SUPERMARKET 1234', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'user-exact-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'user-exact-bank', status: 'booked', bookingDate: '2026-06-12', valueDate: null, amount: '-101.00', currency: 'DKK', description: 'Netto supermarket Copenhagen', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'ai-exact-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'ai-exact-bank', status: 'booked', bookingDate: '2026-06-11', valueDate: null, amount: '-100.50', currency: 'DKK', description: 'Netto supermarket Copenhagen', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'weak-user-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'weak-user-bank', status: 'booked', bookingDate: '2026-06-10', valueDate: null, amount: '-20.00', currency: 'DKK', description: 'IKEA home goods', counterpartyName: 'IKEA', raw: {}, createdAt: now, updatedAt: now},
    {id: 'needs-review-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'needs-review-bank', status: 'booked', bookingDate: '2026-06-09', valueDate: null, amount: '-99.00', currency: 'DKK', description: 'Netto unreviewed', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'system-category-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'system-category-bank', status: 'booked', bookingDate: '2026-06-08', valueDate: null, amount: '-100.00', currency: 'DKK', description: 'Netto uncategorized', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'archived-category-bank', bankAccountId: 'bank-account-1', providerTransactionId: 'archived-category-bank', status: 'booked', bookingDate: '2026-06-07', valueDate: null, amount: '-100.00', currency: 'DKK', description: 'Netto archived', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
    {id: 'team-2-bank', bankAccountId: 'team-2-bank-account', providerTransactionId: 'team-2-bank', status: 'booked', bookingDate: '2026-06-12', valueDate: null, amount: '-100.00', currency: 'DKK', description: 'Netto other team', counterpartyName: 'Netto', raw: {}, createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerTransactions).values([
    {id: 'target-ledger', teamId: 'team-1', source: 'bank_import', status: 'needs_review', categorizedBy: null, date: '2026-06-19', description: 'NETTO SUPERMARKET 1234', createdAt: now, updatedAt: now},
    {id: 'user-exact-ledger', teamId: 'team-1', source: 'bank_import', status: 'confirmed', categorizedBy: 'user', date: '2026-06-12', description: 'Netto supermarket Copenhagen', createdAt: now, updatedAt: now},
    {id: 'ai-exact-ledger', teamId: 'team-1', source: 'bank_import', status: 'confirmed', categorizedBy: 'ai', date: '2026-06-11', description: 'Netto supermarket Copenhagen', createdAt: now, updatedAt: now},
    {id: 'weak-user-ledger', teamId: 'team-1', source: 'bank_import', status: 'confirmed', categorizedBy: 'user', date: '2026-06-10', description: 'IKEA home goods', createdAt: now, updatedAt: now},
    {id: 'needs-review-ledger', teamId: 'team-1', source: 'bank_import', status: 'needs_review', categorizedBy: null, date: '2026-06-09', description: 'Netto unreviewed', createdAt: now, updatedAt: now},
    {id: 'system-category-ledger', teamId: 'team-1', source: 'bank_import', status: 'confirmed', categorizedBy: 'user', date: '2026-06-08', description: 'Netto uncategorized', createdAt: now, updatedAt: now},
    {id: 'archived-category-ledger', teamId: 'team-1', source: 'bank_import', status: 'confirmed', categorizedBy: 'user', date: '2026-06-07', description: 'Netto archived', createdAt: now, updatedAt: now},
    {id: 'team-2-ledger', teamId: 'team-2', source: 'bank_import', status: 'confirmed', categorizedBy: 'user', date: '2026-06-12', description: 'Netto other team', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerPostings).values(postingsFromMovements([
    {id: 'target-movement', ledgerTransactionId: 'target-ledger', debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account', amount: '100.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'user-exact-movement', ledgerTransactionId: 'user-exact-ledger', debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account', amount: '101.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'ai-exact-movement', ledgerTransactionId: 'ai-exact-ledger', debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account', amount: '100.50', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'weak-user-movement', ledgerTransactionId: 'weak-user-ledger', debitAccountId: 'household', creditAccountId: 'bank-ledger-account', amount: '20.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'needs-review-movement', ledgerTransactionId: 'needs-review-ledger', debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account', amount: '99.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'system-category-movement', ledgerTransactionId: 'system-category-ledger', debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account', amount: '100.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'archived-category-movement', ledgerTransactionId: 'archived-category-ledger', debitAccountId: 'archived-category', creditAccountId: 'bank-ledger-account', amount: '100.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'team-2-movement', ledgerTransactionId: 'team-2-ledger', debitAccountId: 'team-2-groceries', creditAccountId: 'team-2-bank-ledger-account', amount: '100.00', currency: 'DKK', sortOrder: 0, createdAt: now, updatedAt: now},
  ]))
}


type LegacyMovement = {
  id: string
  ledgerTransactionId: string
  debitAccountId: string
  creditAccountId: string
  amount: string
  currency: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

function postingsFromMovements(input: LegacyMovement | LegacyMovement[]) {
  const movements = Array.isArray(input) ? input : [input]
  return movements.flatMap(movement => {
    const bankTransactionId = bankTransactionIdForLedgerTransaction(movement.ledgerTransactionId)
    const bankAccountId = movement.creditAccountId.includes('bank-ledger-account') ? movement.creditAccountId : movement.debitAccountId
    const categoryAccountId = bankAccountId === movement.creditAccountId ? movement.debitAccountId : movement.creditAccountId
    const amount = formatFourDecimals(movement.amount)
    const bankAmount = bankAccountId === movement.creditAccountId ? `-${amount}` : amount
    const categoryAmount = bankAmount.startsWith('-') ? amount : `-${amount}`
    return [
      {id: `${movement.id}-bank-posting`, ledgerTransactionId: movement.ledgerTransactionId, accountId: bankAccountId, amount: bankAmount, currency: movement.currency, bankTransactionId, sortOrder: 0, createdAt: movement.createdAt, updatedAt: movement.updatedAt},
      {id: `${movement.id}-category-posting`, ledgerTransactionId: movement.ledgerTransactionId, accountId: categoryAccountId, amount: categoryAmount, currency: movement.currency, bankTransactionId: null, sortOrder: movement.sortOrder + 1, createdAt: movement.createdAt, updatedAt: movement.updatedAt},
    ]
  })
}

function bankTransactionIdForLedgerTransaction(ledgerTransactionId: string) {
  if (ledgerTransactionId.endsWith('-ledger')) return ledgerTransactionId.replace(/-ledger$/, '-bank')
  if (ledgerTransactionId.startsWith('noisy-team-1-ledger-')) return ledgerTransactionId.replace('noisy-team-1-ledger-', 'noisy-team-1-bank-')
  throw new Error(`No bank transaction mapping for ${ledgerTransactionId}`)
}

function formatFourDecimals(amount: string) {
  const [whole, fractional = ''] = amount.split('.')
  return `${whole}.${fractional.padEnd(4, '0').slice(0, 4)}`
}

describe('loadSimilarCategorizationExamples', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedFixture()
  })
  afterAll(async () => closeDatabase())

  it('returns same-team confirmed single-category examples ranked with user-confirmed exact matches first', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
        ],
        limitPerTransaction: 3,
      }),
    )

    const examples = examplesByTransactionId.get('target-ledger') ?? []

    expect(examples.map(example => example.ledgerTransactionId)).toEqual(['user-exact-ledger', 'ai-exact-ledger'])
    expect(examples[0]).toMatchObject({
      categoryAccountId: 'groceries',
      categoryName: 'Groceries',
      categoryGroupName: 'Everyday spending',
      categorizedBy: 'user',
      counterpartyName: 'Netto',
    })
    expect(examples[0]?.similarityReason).toContain('same counterparty')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('target-ledger')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('weak-user-ledger')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('needs-review-ledger')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('system-category-ledger')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('archived-category-ledger')
    expect(examples.map(example => example.ledgerTransactionId)).not.toContain('team-2-ledger')
  })

  it('does not return a confirmed user or AI row without a meaningful similarity signal', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'UNRELATED ELECTRONICS SHOP',
            amount: '-999.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Electronics Shop',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')).toEqual([])
  })

  it('ignores candidate categories that belong to a different team', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    await db.update(ledgerPostings).set({accountId: 'team-2-groceries'}).where(eq(ledgerPostings.id, 'user-exact-movement-category-posting'))

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')?.map(example => example.ledgerTransactionId)).not.toContain('user-exact-ledger')
  })

  it('ignores candidate examples whose reconciled bank posting points to another team bank account', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    const now = new Date('2026-06-19T11:30:00.000Z')
    await db.insert(bankTransactions).values({
      id: 'cross-team-bank',
      bankAccountId: 'team-2-bank-account',
      providerTransactionId: 'cross-team-bank',
      status: 'booked',
      bookingDate: '2026-06-12',
      valueDate: null,
      amount: '-101.00',
      currency: 'DKK',
      description: 'Netto supermarket Copenhagen',
      counterpartyName: 'Netto',
      raw: {},
      createdAt: now,
      updatedAt: now,
    })
    await db.update(ledgerPostings).set({bankTransactionId: 'cross-team-bank'}).where(eq(ledgerPostings.id, 'user-exact-movement-bank-posting'))

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')?.map(example => example.ledgerTransactionId)).not.toContain('user-exact-ledger')
  })

  it('loads candidates with a 200-row bound per target team instead of across all teams', async () => {
    const now = new Date('2026-06-19T11:00:00.000Z')
    const noisyCount = 400
    await db.insert(bankTransactions).values(
      Array.from({length: noisyCount}, (_, index) => ({
        id: `noisy-team-1-bank-${index}`,
        bankAccountId: 'bank-account-1',
        providerTransactionId: `noisy-team-1-bank-${index}`,
        status: 'booked',
        bookingDate: '2026-06-30',
        valueDate: null,
        amount: '-10.00',
        currency: 'DKK',
        description: `Noisy team one ${index}`,
        counterpartyName: `Noise ${index}`,
        raw: {},
        createdAt: now,
        updatedAt: now,
      })),
    )
    await db.insert(ledgerTransactions).values(
      Array.from({length: noisyCount}, (_, index) => ({
        id: `noisy-team-1-ledger-${index}`,
        teamId: 'team-1',
        source: 'bank_import',
        status: 'confirmed',
        categorizedBy: 'user',
        date: '2026-06-30',
        description: `Noisy team one ${index}`,
        createdAt: now,
        updatedAt: now,
      })),
    )
    await db.insert(ledgerPostings).values(postingsFromMovements(
      Array.from({length: noisyCount}, (_, index) => ({
        id: `noisy-team-1-movement-${index}`,
        ledgerTransactionId: `noisy-team-1-ledger-${index}`,
        debitAccountId: 'groceries',
        creditAccountId: 'bank-ledger-account',
        amount: '10.00',
        currency: 'DKK',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })),
    ))

    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
          {
            id: 'team-2-target-ledger',
            teamId: 'team-2',
            date: '2026-06-19',
            description: 'Netto other team',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Other checking',
            counterpartyName: 'Netto',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')?.map(example => example.ledgerTransactionId)).toEqual(['user-exact-ledger', 'ai-exact-ledger'])
    expect(examplesByTransactionId.get('team-2-target-ledger')?.map(example => example.ledgerTransactionId)).toEqual(['team-2-ledger'])
  })

  it('excludes split examples with more than one eligible category account', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')
    const now = new Date('2026-06-19T12:00:00.000Z')
    await db.insert(ledgerPostings).values({
      id: 'user-exact-household-split-posting',
      ledgerTransactionId: 'user-exact-ledger',
      accountId: 'household',
      amount: '1.0000',
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    })

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')?.map(example => example.ledgerTransactionId)).not.toContain('user-exact-ledger')
  })

  it('returns an empty list when no same-team candidate resolves to an eligible category', async () => {
    const {loadSimilarCategorizationExamples} = await import('@/ledger/similar-categorization-examples.server')

    await db.delete(ledgerPostings)

    const examplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: 'user-1',
        transactions: [
          {
            id: 'target-ledger',
            teamId: 'team-1',
            date: '2026-06-19',
            description: 'NETTO SUPERMARKET 1234',
            amount: '-100.00',
            currency: 'DKK',
            bankAccountName: 'Checking',
            counterpartyName: 'Netto',
          },
        ],
      }),
    )

    expect(examplesByTransactionId.get('target-ledger')).toEqual([])
  })
})
