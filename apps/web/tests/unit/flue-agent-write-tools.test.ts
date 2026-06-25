import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers, teams, user} from '@penge/domain/schema'
import {createCategorizationWriteTools} from '../../../flue/src/agent-tools/write-tools'

const now = new Date('2026-06-25T10:00:00.000Z')

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  await resetDatabase()
  await seedWriteToolFixture()
})

afterAll(async () => {
  await closeDatabase()
})

describe('Flue categorization write tools', () => {
  it('applies a high-confidence category through trusted scope and CAS', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    const result = await tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 0,
        confidence: 2,
        reasoning: 'Matched repeated supermarket purchases.',
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      },
    }) as Record<string, unknown>

    expect(result).toEqual({ok: true, status: 'applied'})

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))

    expect(interpretation?.ledgerTransaction).toMatchObject({
      status: 'confirmed',
      categorizedBy: 'ai',
      userConfirmedAt: null,
      userConfirmedBy: null,
    })
    expect(interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId}))).toEqual([
      {accountId: 'bank-ledger-account-1', amount: -1_000_000, bankTransactionId: 'bank-transaction-1'},
      {accountId: 'groceries', amount: 1_000_000, bankTransactionId: null},
    ])
    expect(bankTransaction).toMatchObject({
      aiConfidence: 2,
      aiReasoning: 'Matched repeated supermarket purchases.',
      aiProcessingStartedAt: null,
      categorizationRevision: 1,
    })
  })

  it('keeps low-confidence categories and splits in review and stores split confidence as 1', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    await expect(tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 0,
        confidence: 1,
        reasoning: 'Plausible supermarket match.',
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      },
    })).resolves.toEqual({ok: true, status: 'applied'})

    let interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    let [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(interpretation?.ledgerTransaction).toMatchObject({status: 'needs_review', categorizedBy: 'ai'})
    expect(bankTransaction?.aiConfidence).toBe(1)

    await expect(tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 1,
        confidence: 2,
        reasoning: 'Matches a prior confirmed split receipt.',
        interpretation: {
          kind: 'split',
          lines: [
            {categoryAccountId: 'groceries', amount: '70.00'},
            {categoryAccountId: 'household', amount: '30.00'},
          ],
        },
      },
    })).resolves.toEqual({ok: true, status: 'applied'})

    interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    ;[bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(interpretation?.ledgerTransaction).toMatchObject({status: 'needs_review', categorizedBy: 'ai'})
    expect(interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId}))).toEqual([
      {accountId: 'bank-ledger-account-1', amount: -1_000_000, bankTransactionId: 'bank-transaction-1'},
      {accountId: 'groceries', amount: 700_000, bankTransactionId: null},
      {accountId: 'household', amount: 300_000, bankTransactionId: null},
    ])
    expect(bankTransaction?.aiConfidence).toBe(1)
  })

  it('applies a transfer to an explicit same-team opposite counter transaction', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    await expect(tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 0,
        confidence: 2,
        reasoning: 'Matching opposite transfer between owned accounts.',
        interpretation: {kind: 'transfer', counterBankTransactionId: 'bank-transfer-counter'},
      },
    })).resolves.toEqual({ok: true, status: 'applied'})

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    const counterInterpretation = await currentInterpretationForBankTransaction('bank-transfer-counter')
    const [source] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    const [counter] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transfer-counter'))

    expect(counterInterpretation?.ledgerTransaction?.id).toBe(interpretation?.ledgerTransaction?.id)
    expect(interpretation?.ledgerTransaction).toMatchObject({status: 'confirmed', categorizedBy: 'ai'})
    expect(interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId}))).toEqual([
      {accountId: 'bank-ledger-account-1', amount: -1_000_000, bankTransactionId: 'bank-transaction-1'},
      {accountId: 'bank-ledger-account-2', amount: 1_000_000, bankTransactionId: 'bank-transfer-counter'},
    ])
    expect(source?.categorizationRevision).toBe(1)
    expect(counter?.categorizationRevision).toBe(1)
  })

  it('records unable without creating or replacing an interpretation', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    await expect(tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 0,
        confidence: 0,
        reasoning: 'Merchant is too ambiguous.',
        interpretation: {kind: 'unable'},
      },
    })).resolves.toEqual({ok: true, status: 'applied'})

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))

    expect(interpretation).toBeNull()
    expect(bankTransaction).toMatchObject({aiConfidence: 0, aiReasoning: 'Merchant is too ambiguous.', categorizationRevision: 1})
  })

  it('returns a structured conflict for stale revisions without mutating', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    const result = await tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-1',
        expectedCategorizationRevision: 99,
        confidence: 2,
        reasoning: 'Stale interpretation.',
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      },
    }) as Record<string, unknown>

    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(result).toMatchObject({
      ok: false,
      status: 'conflict',
      bankTransactionId: 'bank-transaction-1',
      expectedCategorizationRevision: 99,
      actualCategorizationRevision: 0,
    })
    expect(String(result.instruction)).toContain('Re-read')
    expect(bankTransaction?.categorizationRevision).toBe(0)
    expect(await currentInterpretationForBankTransaction('bank-transaction-1')).toBeNull()
  })

  it('rejects user-confirmed needs-review rows without bumping the revision', async () => {
    await seedUserConfirmedNeedsReviewInterpretation('bank-transaction-2')
    const before = await currentInterpretationForBankTransaction('bank-transaction-2')
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})

    await expect(tools.applyInterpretation.run({
      input: {
        bankTransactionId: 'bank-transaction-2',
        expectedCategorizationRevision: 0,
        confidence: 2,
        reasoning: 'Would overwrite a user-confirmed review row.',
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      },
    })).resolves.toEqual({ok: false, status: 'rejected', error: 'Bank transaction is not writable in this workflow scope'})

    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-2'))
    const after = await currentInterpretationForBankTransaction('bank-transaction-2')
    expect(bankTransaction?.categorizationRevision).toBe(0)
    expect(after?.ledgerTransaction).toEqual(before?.ledgerTransaction)
    expect(after?.postings).toEqual(before?.postings)
  })

  it('rejects invalid categories, unsafe transfers, unbalanced splits, target violations, and protected rows without partial writes', async () => {
    await seedConfirmedInterpretation('bank-transaction-2')
    const unrestrictedTools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', writeExecutor: db})
    const targetConstrainedTools = toolsByName({
      userId: 'user-1',
      teamId: 'team-1',
      appRunId: 'app-run-1',
      targetBankTransactionIds: ['some-other-target'],
      writeExecutor: db,
    })

    const attempts = [
      unrestrictedTools.applyInterpretation.run({input: {bankTransactionId: 'bank-transaction-1', expectedCategorizationRevision: 0, confidence: 2, reasoning: 'Bad account.', interpretation: {kind: 'category', categoryAccountId: 'inactive-category'}}}),
      unrestrictedTools.applyInterpretation.run({input: {bankTransactionId: 'bank-transaction-1', expectedCategorizationRevision: 0, confidence: 2, reasoning: 'Bad transfer.', interpretation: {kind: 'transfer', counterBankTransactionId: 'other-bank-transaction'}}}),
      unrestrictedTools.applyInterpretation.run({input: {bankTransactionId: 'bank-transaction-1', expectedCategorizationRevision: 0, confidence: 2, reasoning: 'Bad split.', interpretation: {kind: 'split', lines: [{categoryAccountId: 'groceries', amount: '90.00'}]}}}),
      targetConstrainedTools.applyInterpretation.run({input: {bankTransactionId: 'bank-transaction-1', expectedCategorizationRevision: 0, confidence: 2, reasoning: 'Outside target.', interpretation: {kind: 'category', categoryAccountId: 'groceries'}}}),
      unrestrictedTools.applyInterpretation.run({input: {bankTransactionId: 'bank-transaction-2', expectedCategorizationRevision: 0, confidence: 2, reasoning: 'Protected row.', interpretation: {kind: 'category', categoryAccountId: 'groceries'}}}),
    ]

    await expect(Promise.all(attempts)).resolves.toEqual([
      expect.objectContaining({ok: false, status: 'rejected'}),
      expect.objectContaining({ok: false, status: 'rejected'}),
      expect.objectContaining({ok: false, status: 'rejected'}),
      expect.objectContaining({ok: false, status: 'rejected'}),
      expect.objectContaining({ok: false, status: 'rejected'}),
    ])

    const [targetTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    const protectedInterpretation = await currentInterpretationForBankTransaction('bank-transaction-2')
    expect(targetTransaction?.categorizationRevision).toBe(0)
    expect(await currentInterpretationForBankTransaction('bank-transaction-1')).toBeNull()
    expect(protectedInterpretation?.ledgerTransaction).toMatchObject({status: 'confirmed', categorizedBy: 'user'})
  })
})

type WriteToolScope = Parameters<typeof createCategorizationWriteTools>[0]

function toolsByName(scope: WriteToolScope) {
  return Object.fromEntries(createCategorizationWriteTools(scope).map(tool => [tool.name, tool])) as Record<string, ReturnType<typeof createCategorizationWriteTools>[number]>
}

async function seedWriteToolFixture() {
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other Team', personalOwnerUserId: 'user-2', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccountGroups).values([
    {id: 'group-1', teamId: 'team-1', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-2', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    bankAccount('bank-account-1', 'team-1', 'Checking'),
    bankAccount('bank-account-2', 'team-1', 'Savings'),
    bankAccount('bank-account-3', 'team-2', 'Other Checking'),
  ])
  await db.insert(ledgerAccounts).values([
    ledgerAccount('bank-ledger-account-1', 'team-1', 'bank', 'Checking', {linkedBankAccountId: 'bank-account-1'}),
    ledgerAccount('bank-ledger-account-2', 'team-1', 'bank', 'Savings', {linkedBankAccountId: 'bank-account-2'}),
    ledgerAccount('groceries', 'team-1', 'expense', 'Groceries'),
    ledgerAccount('household', 'team-1', 'expense', 'Household'),
    ledgerAccount('inactive-category', 'team-1', 'expense', 'Inactive', {status: 'archived'}),
    ledgerAccount('other-groceries', 'team-2', 'expense', 'Other Groceries', {groupId: 'group-2'}),
    ledgerAccount('bank-ledger-account-3', 'team-2', 'bank', 'Other Checking', {linkedBankAccountId: 'bank-account-3', groupId: 'group-2'}),
  ])
  await db.insert(bankTransactions).values([
    bankTransaction('bank-transaction-1', 'bank-account-1', -1_000_000, 'Supermarket purchase', 0),
    bankTransaction('bank-transfer-counter', 'bank-account-2', 1_000_000, 'Transfer in', 0),
    bankTransaction('bank-transaction-2', 'bank-account-1', -1_000_000, 'Protected purchase', 0),
    bankTransaction('other-bank-transaction', 'bank-account-3', -1_000_000, 'Other team purchase', 0),
  ])
}

function bankAccount(id: string, teamId: string, name: string) {
  return {
    id,
    teamId,
    bankConnectionId: null,
    provider: 'gocardless',
    providerInstitutionId: `institution-${id}`,
    providerRequisitionId: `requisition-${id}`,
    providerAccountId: `provider-${id}`,
    name,
    iban: null,
    currency: 'DKK',
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function ledgerAccount(
  id: string,
  teamId: string,
  type: string,
  name: string,
  options: {linkedBankAccountId?: string | null; groupId?: string; status?: string} = {},
) {
  return {
    id,
    teamId,
    groupId: options.groupId ?? 'group-1',
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: null,
    type,
    normalBalance: type === 'bank' ? 'debit' : 'credit',
    name,
    description: '',
    status: options.status ?? 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function bankTransaction(id: string, bankAccountId: string, amount: number, description: string, categorizationRevision: number) {
  return {
    id,
    bankAccountId,
    providerTransactionId: `provider-${id}`,
    status: 'booked',
    bookingDate: '2026-06-25',
    valueDate: null,
    amount,
    currency: 'DKK',
    description,
    counterpartyName: null,
    raw: {},
    aiConfidence: null,
    aiProcessingStartedAt: null,
    aiReasoning: null,
    categorizationRevision,
    createdAt: now,
    updatedAt: now,
  }
}

async function seedConfirmedInterpretation(bankTransactionId: string) {
  await seedExistingInterpretation(bankTransactionId, {status: 'confirmed', categorizedBy: 'user', userConfirmedAt: now, userConfirmedBy: 'user-1'})
}

async function seedUserConfirmedNeedsReviewInterpretation(bankTransactionId: string) {
  await seedExistingInterpretation(bankTransactionId, {status: 'needs_review', categorizedBy: 'ai', userConfirmedAt: now, userConfirmedBy: 'user-1'})
}

async function seedExistingInterpretation(
  bankTransactionId: string,
  input: {status: string; categorizedBy: string; userConfirmedAt: Date | null; userConfirmedBy: string | null},
) {
  await db.insert(ledgerTransactions).values({
    id: `ledger-${bankTransactionId}`,
    teamId: 'team-1',
    source: 'bank_import',
    status: input.status,
    categorizedBy: input.categorizedBy,
    userConfirmedAt: input.userConfirmedAt,
    userConfirmedBy: input.userConfirmedBy,
    date: '2026-06-25',
    description: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(ledgerPostings).values([
    {
      id: `posting-bank-${bankTransactionId}`,
      ledgerTransactionId: `ledger-${bankTransactionId}`,
      accountId: 'bank-ledger-account-1',
      amount: -1_000_000,
      currency: 'DKK',
      bankTransactionId,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `posting-category-${bankTransactionId}`,
      ledgerTransactionId: `ledger-${bankTransactionId}`,
      accountId: 'household',
      amount: 1_000_000,
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
  ])
}

async function currentInterpretationForBankTransaction(bankTransactionId: string) {
  const [bankPosting] = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
  if (!bankPosting) return null

  const [ledgerTransaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, bankPosting.ledgerTransactionId))
  const postings = await db
    .select()
    .from(ledgerPostings)
    .where(eq(ledgerPostings.ledgerTransactionId, bankPosting.ledgerTransactionId))
    .orderBy(ledgerPostings.sortOrder)

  return {bankPosting, ledgerTransaction, postings}
}

