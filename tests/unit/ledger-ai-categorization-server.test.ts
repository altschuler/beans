import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {db} from '@/db/client'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerTransactionMovements,
  ledgerTransactions,
  teamMembers,
  teams,
  user,
} from '@/db/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import type {AiCategorizationModelInput, AiCategorizationSuggestion} from '@/ledger/ai-categorization.server'

type CategorizeWithModel = (input: AiCategorizationModelInput) => Promise<AiCategorizationSuggestion[]>

const generateObject = vi.hoisted(() => vi.fn(async (options: {schema: unknown}) => {
  void options
  return {object: {suggestions: []}}
}))
const openai = vi.hoisted(() => vi.fn((model: string) => ({model})))

vi.mock('ai', () => ({generateObject}))
vi.mock('@ai-sdk/openai', () => ({openai}))

async function seedAiCategorizationFixture() {
  const now = new Date('2026-06-18T10:00:00.000Z')
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
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
    {id: 'adjustment-group', teamId: 'team-1', name: 'Adjustments', sortOrder: 2, createdAt: now, updatedAt: now},
    {id: 'team-2-bank-group', teamId: 'team-2', name: 'Bank accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'team-2-spending-group', teamId: 'team-2', name: 'Everyday spending', sortOrder: 1, createdAt: now, updatedAt: now},
    {id: 'team-2-adjustment-group', teamId: 'team-2', name: 'Adjustments', sortOrder: 2, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values({
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
  })
  await db.insert(ledgerAccounts).values([
    {
      id: 'bank-ledger-account',
      teamId: 'team-1',
      groupId: 'bank-group',
      linkedBankAccountId: 'bank-account-1',
      systemKey: null,
      type: 'bank',
      normalBalance: 'debit',
      name: 'Checking',
      description: '',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'uncategorized',
      teamId: 'team-1',
      groupId: 'adjustment-group',
      linkedBankAccountId: null,
      systemKey: 'uncategorized',
      type: 'adjustment',
      normalBalance: 'credit',
      name: 'Uncategorized',
      description: 'Fallback category',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'corrections',
      teamId: 'team-1',
      groupId: 'adjustment-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'adjustment',
      normalBalance: 'credit',
      name: 'Corrections',
      description: 'Accounting corrections',
      status: 'active',
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'groceries',
      teamId: 'team-1',
      groupId: 'spending-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Groceries',
      description: 'Supermarkets and food shops',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'household',
      teamId: 'team-1',
      groupId: 'spending-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Household',
      description: 'Home goods',
      status: 'active',
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'archived-category',
      teamId: 'team-1',
      groupId: 'spending-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Archived category',
      description: 'Not available',
      status: 'archived',
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'team-2-uncategorized',
      teamId: 'team-2',
      groupId: 'team-2-adjustment-group',
      linkedBankAccountId: null,
      systemKey: 'uncategorized',
      type: 'adjustment',
      normalBalance: 'credit',
      name: 'Uncategorized',
      description: 'Fallback category',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'team-2-groceries',
      teamId: 'team-2',
      groupId: 'team-2-spending-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Groceries',
      description: 'Other team supermarkets and food shops',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(bankTransactions).values([
    {
      id: 'bank-transaction-1',
      bankAccountId: 'bank-account-1',
      providerTransactionId: 'provider-transaction-1',
      status: 'booked',
      bookingDate: '2026-06-18',
      valueDate: null,
      amount: '-100.00',
      currency: 'DKK',
      description: 'Netto supermarket',
      counterpartyName: 'Netto',
      raw: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bank-transaction-2',
      bankAccountId: 'bank-account-1',
      providerTransactionId: 'provider-transaction-2',
      status: 'booked',
      bookingDate: '2026-06-17',
      valueDate: null,
      amount: '-50.00',
      currency: 'DKK',
      description: 'Unknown shop',
      counterpartyName: null,
      raw: {},
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(ledgerTransactions).values([
    {
      id: 'ledger-transaction-1',
      teamId: 'team-1',
      bankTransactionId: 'bank-transaction-1',
      source: 'bank_import',
      status: 'needs_review',
      aiConfidence: null,
      aiProcessingStartedAt: null,
      date: '2026-06-18',
      description: 'Netto supermarket',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ledger-transaction-2',
      teamId: 'team-1',
      bankTransactionId: 'bank-transaction-2',
      source: 'bank_import',
      status: 'needs_review',
      aiConfidence: null,
      aiProcessingStartedAt: null,
      date: '2026-06-17',
      description: 'Unknown shop',
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(ledgerTransactionMovements).values([
    {
      id: 'movement-1',
      ledgerTransactionId: 'ledger-transaction-1',
      debitAccountId: 'uncategorized',
      creditAccountId: 'bank-ledger-account',
      amount: '100.00',
      currency: 'DKK',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'movement-2',
      ledgerTransactionId: 'ledger-transaction-2',
      debitAccountId: 'uncategorized',
      creditAccountId: 'bank-ledger-account',
      amount: '50.00',
      currency: 'DKK',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
  ])
}

async function seedAdditionalNeedsReviewTransactions(count: number) {
  const now = new Date('2026-06-18T11:00:00.000Z')
  await db.insert(bankTransactions).values(
    Array.from({length: count}, (_, index) => ({
      id: `extra-bank-transaction-${index}`,
      bankAccountId: 'bank-account-1',
      providerTransactionId: `extra-provider-transaction-${index}`,
      status: 'booked',
      bookingDate: `2026-05-${String(28 - (index % 20)).padStart(2, '0')}`,
      valueDate: null,
      amount: '-10.00',
      currency: 'DKK',
      description: `Extra transaction ${index}`,
      counterpartyName: null,
      raw: {},
      createdAt: now,
      updatedAt: now,
    })),
  )
  await db.insert(ledgerTransactions).values(
    Array.from({length: count}, (_, index) => ({
      id: `extra-ledger-transaction-${index}`,
      teamId: 'team-1',
      bankTransactionId: `extra-bank-transaction-${index}`,
      source: 'bank_import',
      status: 'needs_review',
      aiConfidence: null,
      aiProcessingStartedAt: null,
      date: `2026-05-${String(28 - (index % 20)).padStart(2, '0')}`,
      description: `Extra transaction ${index}`,
      createdAt: now,
      updatedAt: now,
    })),
  )
  await db.insert(ledgerTransactionMovements).values(
    Array.from({length: count}, (_, index) => ({
      id: `extra-movement-${index}`,
      ledgerTransactionId: `extra-ledger-transaction-${index}`,
      debitAccountId: 'uncategorized',
      creditAccountId: 'bank-ledger-account',
      amount: '10.00',
      currency: 'DKK',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

async function seedSecondTeamTransaction() {
  const now = new Date('2026-06-18T12:00:00.000Z')
  await db.insert(bankAccounts).values({
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
  })
  await db.insert(ledgerAccounts).values({
    id: 'team-2-bank-ledger-account',
    teamId: 'team-2',
    groupId: 'team-2-bank-group',
    linkedBankAccountId: 'team-2-bank-account',
    systemKey: null,
    type: 'bank',
    normalBalance: 'debit',
    name: 'Other checking',
    description: '',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(bankTransactions).values({
    id: 'team-2-bank-transaction',
    bankAccountId: 'team-2-bank-account',
    providerTransactionId: 'team-2-provider-transaction',
    status: 'booked',
    bookingDate: '2026-06-19',
    valueDate: null,
    amount: '-25.00',
    currency: 'DKK',
    description: 'Other team grocery',
    counterpartyName: 'Other Netto',
    raw: {},
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(ledgerTransactions).values({
    id: 'team-2-ledger-transaction',
    teamId: 'team-2',
    bankTransactionId: 'team-2-bank-transaction',
    source: 'bank_import',
    status: 'needs_review',
    aiConfidence: null,
    aiProcessingStartedAt: null,
    date: '2026-06-19',
    description: 'Other team grocery',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(ledgerTransactionMovements).values({
    id: 'team-2-movement',
    ledgerTransactionId: 'team-2-ledger-transaction',
    debitAccountId: 'team-2-uncategorized',
    creditAccountId: 'team-2-bank-ledger-account',
    amount: '25.00',
    currency: 'DKK',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
}

describe('aiCategorizeLedgerTransactions', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedAiCategorizationFixture()
  })
  afterAll(async () => closeDatabase())

  it('sends only same-team eligible categories to the model and confirms high-confidence suggestions', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [
      {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'groceries', confidence: 2, reasoning: 'Known supermarket'},
    ])

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)

    expect(categorizeWithModel).toHaveBeenCalledOnce()
    expect(categorizeWithModel.mock.calls[0]?.[0].categories.map(category => category.id)).toEqual(['groceries', 'household'])
    expect(categorizeWithModel.mock.calls[0]?.[0].categories.map(category => category.id)).not.toContain('team-2-groceries')
    expect(categorizeWithModel.mock.calls[0]?.[0].transactions.map(transaction => transaction.id)).toEqual(['ledger-transaction-1'])
    expect(result).toEqual({requested: 1, suggested: 1, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 0})

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('confirmed')
    expect(transaction?.aiConfidence).toBe(2)
    expect(transaction?.aiProcessingStartedAt).toBeNull()
    expect(movement).toMatchObject({debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account', amount: '100.0000'})
  })

  it('groups multi-team batches and sends only matching team categories with each transaction set', async () => {
    await seedSecondTeamTransaction()
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async input =>
      input.transactions.map(transaction => ({ledgerTransactionId: transaction.id, categoryAccountId: input.categories[0]?.id ?? '', confidence: 2, reasoning: null})),
    )

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', limit: 25}, categorizeWithModel)

    expect(categorizeWithModel).toHaveBeenCalledTimes(2)
    const modelInputs = categorizeWithModel.mock.calls.map(call => call[0])
    const teamOneInput = modelInputs.find(call => call.transactions.some(transaction => transaction.id === 'ledger-transaction-1'))
    const teamTwoInput = modelInputs.find(call => call.transactions.some(transaction => transaction.id === 'team-2-ledger-transaction'))
    expect(teamOneInput?.categories.map(category => category.id)).toEqual(['groceries', 'household'])
    expect(teamOneInput?.transactions.map(transaction => transaction.id)).toEqual(['ledger-transaction-1', 'ledger-transaction-2'])
    expect(teamTwoInput?.categories.map(category => category.id)).toEqual(['team-2-groceries'])
    expect(teamTwoInput?.transactions.map(transaction => transaction.id)).toEqual(['team-2-ledger-transaction'])
    expect(result).toEqual({requested: 3, suggested: 3, applied: 3, confirmed: 3, stillNeedsReview: 0, skipped: 0})
  })

  it('applies low-confidence suggestions but keeps them in review', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [
      {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'groceries', confidence: 1, reasoning: 'Plausible supermarket match'},
    ])

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(result).toEqual({requested: 1, suggested: 1, applied: 1, confirmed: 0, stillNeedsReview: 1, skipped: 0})
    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBe(1)
    expect(transaction?.aiProcessingStartedAt).toBeNull()
  })

  it('skips cross-team invalid and duplicate suggestions without aborting the batch', async () => {
    await seedSecondTeamTransaction()
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async input => {
      if (input.transactions.some(transaction => transaction.id === 'ledger-transaction-1')) {
        return [
          {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'team-2-groceries', confidence: 2, reasoning: 'Wrong team category'},
          {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'groceries', confidence: 2, reasoning: 'First valid suggestion'},
          {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'household', confidence: 2, reasoning: 'Duplicate suggestion'},
        ]
      }
      return []
    })

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1', 'team-2-ledger-transaction']}, categorizeWithModel)

    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(result).toEqual({requested: 2, suggested: 3, applied: 1, confirmed: 1, stillNeedsReview: 0, skipped: 2})
    expect(movement).toMatchObject({debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account'})
  })

  it('ignores suggestions with unknown transaction ids or category ids', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [
      {ledgerTransactionId: 'missing-transaction', categoryAccountId: 'groceries', confidence: 2, reasoning: 'Invalid transaction'},
      {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'uncategorized', confidence: 2, reasoning: 'Invalid category'},
    ])

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(result).toEqual({requested: 1, suggested: 2, applied: 0, confirmed: 0, stillNeedsReview: 0, skipped: 2})
    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBeNull()
  })

  it('skips stale transactions that are no longer in review after the model call', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => {
      const now = new Date('2026-06-18T12:30:00.000Z')
      await db.update(ledgerTransactions).set({status: 'confirmed', aiConfidence: null, updatedAt: now}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
      await db.delete(ledgerTransactionMovements).where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))
      await db.insert(ledgerTransactionMovements).values({
        id: 'manual-movement-1',
        ledgerTransactionId: 'ledger-transaction-1',
        debitAccountId: 'household',
        creditAccountId: 'bank-ledger-account',
        amount: '100.00',
        currency: 'DKK',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      return [{ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'groceries', confidence: 2, reasoning: 'Stale suggestion'}]
    })

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(result).toEqual({requested: 1, suggested: 1, applied: 0, confirmed: 0, stillNeedsReview: 0, skipped: 1})
    expect(transaction?.status).toBe('confirmed')
    expect(transaction?.aiConfidence).toBeNull()
    expect(movement).toMatchObject({debitAccountId: 'household', creditAccountId: 'bank-ledger-account', amount: '100.0000'})
  })

  it('records confidence 0 without applying the suggested category', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [
      {ledgerTransactionId: 'ledger-transaction-1', categoryAccountId: 'groceries', confidence: 0, reasoning: 'Too ambiguous'},
    ])

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(result).toEqual({requested: 1, suggested: 1, applied: 0, confirmed: 0, stillNeedsReview: 1, skipped: 0})
    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBe(0)
    expect(transaction?.aiProcessingStartedAt).toBeNull()
    expect(movement).toMatchObject({debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account', amount: '100.0000'})
  })

  it('marks transactions processing before the model call and clears processing when the model fails', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => {
      const [duringModelCall] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
      expect(duringModelCall?.aiProcessingStartedAt).toBeInstanceOf(Date)
      throw new Error('model unavailable')
    })

    await expect(aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)).rejects.toThrow(
      'model unavailable',
    )

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBeNull()
    expect(transaction?.aiProcessingStartedAt).toBeNull()
    expect(movement).toMatchObject({debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account', amount: '100.0000'})
  })

  it('caps batch categorization at 25 transactions server-side', async () => {
    await seedAdditionalNeedsReviewTransactions(24)
    const {aiCategorizeLedgerTransactions, MAX_AI_CATEGORIZATION_BATCH_SIZE} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [])

    const result = await aiCategorizeLedgerTransactions({userId: 'user-1', limit: 100}, categorizeWithModel)

    expect(MAX_AI_CATEGORIZATION_BATCH_SIZE).toBe(25)
    expect(categorizeWithModel).toHaveBeenCalledOnce()
    expect(categorizeWithModel.mock.calls[0]?.[0].transactions).toHaveLength(25)
    expect(result.requested).toBe(25)
  })

  it('does not clear a newer processing marker from a concurrent AI attempt', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const newerProcessingStartedAt = new Date('2026-06-18T12:45:00.000Z')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => {
      await db.update(ledgerTransactions).set({aiProcessingStartedAt: newerProcessingStartedAt}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
      throw new Error('model unavailable')
    })

    await expect(aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel)).rejects.toThrow(
      'model unavailable',
    )

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(transaction?.aiProcessingStartedAt).toEqual(newerProcessingStartedAt)
  })

  it('clears processing when no eligible categories are available after claiming work', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')

    await db.update(ledgerAccounts).set({status: 'archived'}).where(eq(ledgerAccounts.id, 'groceries'))
    await db.update(ledgerAccounts).set({status: 'archived'}).where(eq(ledgerAccounts.id, 'household'))

    await expect(aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']})).rejects.toThrow(
      'No categories available for AI categorization',
    )

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBeNull()
    expect(transaction?.aiProcessingStartedAt).toBeNull()
  })

  it('leaves transactions unchanged when the model call fails', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => {
      throw new Error('model unavailable')
    })

    await expect(
      aiCategorizeLedgerTransactions({userId: 'user-1', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel),
    ).rejects.toThrow('model unavailable')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBeNull()
    expect(movement).toMatchObject({debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account', amount: '100.0000'})
  })

  it('uses an OpenAI-compatible structured output schema with all suggestion properties required', async () => {
    const {categorizeWithOpenAI} = await import('@/ledger/ai-categorization.server')
    const originalOpenAiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-openai-key'

    try {
      await categorizeWithOpenAI({categories: [], transactions: []})
    } finally {
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAiKey
    }

    const generateObjectCall = generateObject.mock.calls.at(-1)
    expect(generateObjectCall).toBeDefined()
    const schema = generateObjectCall?.[0].schema
    expect(schema).toBeDefined()
    const jsonSchema = z.toJSONSchema(schema as z.ZodType) as unknown as {
      properties: {suggestions: {items: {properties: Record<string, unknown>; required: string[]}}}
    }
    const suggestionSchema = jsonSchema.properties.suggestions.items

    expect(openai).toHaveBeenCalledWith('gpt-5.4-nano')
    expect(suggestionSchema.required).toEqual(Object.keys(suggestionSchema.properties))
    expect(suggestionSchema.required).toContain('reasoning')
    expect(suggestionSchema.required).toContain('categoryAccountId')
    expect(JSON.stringify(jsonSchema)).toContain('0')
    expect(JSON.stringify(jsonSchema)).toContain('1')
    expect(JSON.stringify(jsonSchema)).toContain('2')
  })

  it('rejects users outside the transaction team', async () => {
    const {aiCategorizeLedgerTransactions} = await import('@/ledger/ai-categorization.server')
    const categorizeWithModel = vi.fn<CategorizeWithModel>(async () => [])

    await expect(
      aiCategorizeLedgerTransactions({userId: 'user-2', ledgerTransactionIds: ['ledger-transaction-1']}, categorizeWithModel),
    ).rejects.toThrow('No transactions available for AI categorization')
  })
})
