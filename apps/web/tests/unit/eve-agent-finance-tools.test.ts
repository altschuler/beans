import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
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
} from '@penge/domain/schema'

const now = new Date('2026-07-09T10:00:00.000Z')
let toolCallSequence = 0

type DynamicResolver = {
  events: {
    'session.started': (event: unknown, context: ToolContext) => Record<string, ResolvedTool>
  }
}

type ResolvedTool = {
  inputSchema: {parse(input: unknown): unknown}
  execute(input: unknown, context: ToolContext): Promise<unknown>
}

type ToolContext = {
  callId: string
  session: {
    auth: {
      current: {
        attributes: Record<string, string | readonly string[]>
        authenticator: string
        principalId: string
        principalType: string
      }
      initiator: null
    }
    id: string
    turn: {id: string; sequence: number}
  }
}

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  toolCallSequence = 0
  await resetDatabase()
  await seedFixture()
})

afterAll(async () => {
  await closeDatabase()
})

describe('eve finance tools', () => {
  it('fails closed when a task capability contains an empty target list', async () => {
    await expect(resolveTools({
      purpose: 'categorization-task',
      userId: 'user-1',
      teamId: 'team-1',
      appRunId: 'run-1',
      targetBankTransactionIds: [],
    })).rejects.toThrow('Invalid trusted eve runtime scope')
  })

  it('rolls back a confirmed chat batch when any row conflicts', async () => {
    const chatScope = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'} as const
    const chat = await resolveTools(chatScope)

    await expect(execute(chat.applyCategorizations, {
      categorizations: [
        {
          bankTransactionId: 'transaction-task',
          expectedCategorizationRevision: 0,
          interpretation: {kind: 'category', categoryAccountId: 'groceries'},
        },
        {
          bankTransactionId: 'transaction-chat',
          expectedCategorizationRevision: 99,
          interpretation: {kind: 'category', categoryAccountId: 'groceries'},
        },
      ],
    }, chatScope)).resolves.toMatchObject({
      ok: false,
      status: 'conflict',
      appliedCount: 0,
      conflictCount: 1,
    })

    await expect(interpretationFor('transaction-task')).resolves.toBeNull()
    const rows = await db.select().from(bankTransactions).where(eq(bankTransactions.bankAccountId, 'bank-1'))
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'transaction-task', categorizationRevision: 0}),
      expect.objectContaining({id: 'transaction-chat', categorizationRevision: 0}),
    ]))
  })

  it('does not let an autonomous task overwrite a user-confirmed interpretation', async () => {
    const chatScope = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'} as const
    const chat = await resolveTools(chatScope)
    await execute(chat.applyCategorizations, {
      categorizations: [{
        bankTransactionId: 'transaction-task',
        expectedCategorizationRevision: 0,
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      }],
    }, chatScope)

    const taskScope = {
      purpose: 'categorization-task',
      userId: 'user-1',
      teamId: 'team-1',
      appRunId: 'run-1',
      targetBankTransactionIds: ['transaction-task'],
    } as const
    const task = await resolveTools(taskScope)
    await expect(execute(task.applyCategorizationSuggestion, {
      bankTransactionId: 'transaction-task',
      expectedCategorizationRevision: 1,
      confidence: 2,
      reasoning: 'This must not replace a user-confirmed row.',
      interpretation: {kind: 'category', categoryAccountId: 'groceries'},
    }, taskScope)).resolves.toMatchObject({ok: false, status: 'rejected'})

    await expect(interpretationFor('transaction-task')).resolves.toMatchObject({
      transaction: {categorizedBy: 'user', userConfirmedBy: 'user-1'},
    })
  })

  it('replays category creation with the same eve call id without duplicating the resource', async () => {
    const chatScope = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'} as const
    const chat = await resolveTools(chatScope)
    const operation = {operation: {kind: 'createGroup', name: 'Bills'}}

    const first = await execute(chat.manageCategory, operation, chatScope, 'category-call-1') as Record<string, unknown>
    const replay = await execute(chat.manageCategory, operation, chatScope, 'category-call-1') as Record<string, unknown>

    expect(first).toMatchObject({ok: true, status: 'applied', groupId: expect.any(String)})
    expect(replay).toEqual(first)
    await expect(db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.name, 'Bills'))).resolves.toHaveLength(1)

    const deletion = {operation: {kind: 'deleteGroup', groupId: first.groupId, expectedName: 'Bills'}}
    const firstDelete = await execute(chat.manageCategory, deletion, chatScope, 'category-delete-call-1')
    const replayedDelete = await execute(chat.manageCategory, deletion, chatScope, 'category-delete-call-1')
    expect(firstDelete).toEqual({ok: true, status: 'applied'})
    expect(replayedDelete).toEqual(firstDelete)
  })

  it('rejects category updates and deletes when the approved target name has changed', async () => {
    const chatScope = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'} as const
    const chat = await resolveTools(chatScope)

    await db.update(ledgerAccountGroups).set({name: 'Renamed group'}).where(eq(ledgerAccountGroups.id, 'group-1'))
    await expect(execute(chat.manageCategory, {
      operation: {kind: 'updateGroup', groupId: 'group-1', expectedName: 'Categories', name: 'Final group'},
    }, chatScope)).resolves.toEqual({
      ok: false,
      status: 'conflict',
      error: 'Category group changed after approval. Review the latest category group and try again.',
    })
    expect((await db.select({name: ledgerAccountGroups.name}).from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, 'group-1')))[0]?.name).toBe('Renamed group')

    await db.insert(ledgerAccountGroups).values({
      id: 'empty-group', teamId: 'team-1', systemKey: null, name: 'Renamed empty group', sortOrder: 2, createdAt: now, updatedAt: now,
    })
    await expect(execute(chat.manageCategory, {
      operation: {kind: 'deleteGroup', groupId: 'empty-group', expectedName: 'Empty group'},
    }, chatScope)).resolves.toMatchObject({ok: false, status: 'conflict'})
    expect(await db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, 'empty-group'))).toHaveLength(1)

    await db.update(ledgerAccounts).set({name: 'Food'}).where(eq(ledgerAccounts.id, 'groceries'))
    await expect(execute(chat.manageCategory, {
      operation: {
        kind: 'updateCategory', accountId: 'groceries', expectedName: 'Groceries', groupId: 'group-1',
        name: 'Dining', description: '', type: 'expense',
      },
    }, chatScope)).resolves.toEqual({
      ok: false,
      status: 'conflict',
      error: 'Category changed after approval. Review the latest category and try again.',
    })
    expect((await db.select({name: ledgerAccounts.name}).from(ledgerAccounts).where(eq(ledgerAccounts.id, 'groceries')))[0]?.name).toBe('Food')

    await expect(execute(chat.manageCategory, {
      operation: {kind: 'deleteCategory', accountId: 'groceries', expectedName: 'Groceries'},
    }, chatScope)).resolves.toMatchObject({ok: false, status: 'conflict'})
    expect(await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, 'groceries'))).toHaveLength(1)
  })

  it('executes task and chat capabilities through trusted scoped domain services', async () => {
    const taskScope = {
      purpose: 'categorization-task',
      userId: 'user-1',
      teamId: 'team-1',
      appRunId: 'run-1',
      targetBankTransactionIds: ['transaction-task'],
    } as const
    const task = await resolveTools(taskScope)

    const searchResult = await execute(task.searchBankTransactions, {reviewStatus: 'any', limit: 10}, taskScope) as Array<Record<string, unknown>>
    expect(searchResult.map(row => row.id)).toEqual(['transaction-chat', 'transaction-task'])
    expect(searchResult.find(row => row.id === 'transaction-task')).toMatchObject({canWrite: true, categorizationRevision: 0})
    expect(searchResult.find(row => row.id === 'transaction-chat')).toMatchObject({canWrite: false})
    expect(searchResult).not.toEqual(expect.arrayContaining([expect.objectContaining({id: 'transaction-other-team'})]))

    await expect(execute(task.applyCategorizationSuggestion, {
      bankTransactionId: 'transaction-chat',
      expectedCategorizationRevision: 0,
      confidence: 2,
      reasoning: 'This row is outside the task target.',
      interpretation: {kind: 'category', categoryAccountId: 'groceries'},
    }, taskScope)).resolves.toMatchObject({ok: false, status: 'rejected'})
    await expect(execute(task.applyCategorizationSuggestion, {
      bankTransactionId: 'transaction-other-team',
      expectedCategorizationRevision: 0,
      confidence: 2,
      reasoning: 'This row belongs to another team.',
      interpretation: {kind: 'category', categoryAccountId: 'groceries'},
    }, taskScope)).resolves.toMatchObject({ok: false, status: 'rejected'})
    await expect(interpretationFor('transaction-chat')).resolves.toBeNull()
    await expect(interpretationFor('transaction-other-team')).resolves.toBeNull()

    const taskWrite = {
      bankTransactionId: 'transaction-task',
      expectedCategorizationRevision: 0,
      confidence: 2,
      reasoning: 'Matches repeated grocery purchases.',
      interpretation: {kind: 'category', categoryAccountId: 'groceries'},
    }
    const firstTaskResult = await execute(task.applyCategorizationSuggestion, taskWrite, taskScope, 'categorize-call-1')
    const replayedTaskResult = await execute(task.applyCategorizationSuggestion, taskWrite, taskScope, 'categorize-call-1')
    expect(firstTaskResult).toEqual({ok: true, status: 'applied'})
    expect(replayedTaskResult).toEqual(firstTaskResult)

    const taskInterpretation = await interpretationFor('transaction-task')
    expect(taskInterpretation?.transaction).toMatchObject({status: 'confirmed', categorizedBy: 'ai', userConfirmedBy: null})
    expect(taskInterpretation?.postings.map(posting => posting.accountId)).toEqual(['bank-ledger-1', 'groceries'])

    const chatScope = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'} as const
    const chat = await resolveTools(chatScope)
    await expect(execute(chat.applyCategorizations, {
      categorizations: [{
        bankTransactionId: 'transaction-chat',
        expectedCategorizationRevision: 0,
        interpretation: {kind: 'category', categoryAccountId: 'groceries'},
      }],
    }, chatScope)).resolves.toMatchObject({ok: true, status: 'completed', appliedCount: 1, rejectedCount: 0, conflictCount: 0})

    const chatInterpretation = await interpretationFor('transaction-chat')
    expect(chatInterpretation?.transaction).toMatchObject({status: 'confirmed', categorizedBy: 'user', userConfirmedBy: 'user-1'})

    const categoryResult = await execute(chat.manageCategory, {operation: {kind: 'createGroup', name: '  Bills  '}}, chatScope) as Record<string, unknown>
    expect(categoryResult).toMatchObject({ok: true, status: 'applied', groupId: expect.any(String)})
    await expect(db.select().from(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, categoryResult.groupId as string))).resolves.toMatchObject([
      {teamId: 'team-1', name: 'Bills'},
    ])
  })
})

async function resolveTools(attributes: Record<string, string | readonly string[]>) {
  const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as DynamicResolver
  return resolver.events['session.started']({}, context(attributes))
}

async function execute(
  tool: ResolvedTool,
  input: unknown,
  attributes: Record<string, string | readonly string[]>,
  callId = `tool-call-${++toolCallSequence}`,
) {
  return tool.execute(tool.inputSchema.parse(input), context(attributes, callId))
}

function context(attributes: Record<string, string | readonly string[]>, callId = 'resolver-call'): ToolContext {
  return {
    callId,
    session: {
      auth: {
        current: {
          attributes,
          authenticator: 'penge-web',
          principalId: 'user-1',
          principalType: attributes.purpose === 'chat-session' ? 'user' : 'service',
        },
        initiator: null,
      },
      id: 'session-1',
      turn: {id: 'turn-1', sequence: 1},
    },
  }
}

async function interpretationFor(bankTransactionId: string) {
  const [bankPosting] = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
  if (!bankPosting) return null
  const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, bankPosting.ledgerTransactionId))
  const postings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.ledgerTransactionId, bankPosting.ledgerTransactionId)).orderBy(ledgerPostings.sortOrder)
  return {transaction, postings}
}

async function seedFixture() {
  await db.insert(user).values([
    {id: 'user-1', name: 'User', email: 'user@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other team', personalOwnerUserId: 'user-2', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccountGroups).values([
    {id: 'group-1', teamId: 'team-1', systemKey: null, name: 'Categories', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-2', systemKey: null, name: 'Other categories', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    bankAccount('bank-1', 'team-1', 'Checking'),
    bankAccount('bank-2', 'team-2', 'Other checking'),
  ])
  await db.insert(ledgerAccounts).values([
    ledgerAccount('bank-ledger-1', 'team-1', 'group-1', 'bank', 'Checking', {linkedBankAccountId: 'bank-1'}),
    ledgerAccount('uncategorized-1', 'team-1', 'group-1', 'adjustment', 'Uncategorized', {systemKey: 'uncategorized'}),
    ledgerAccount('groceries', 'team-1', 'group-1', 'expense', 'Groceries'),
    ledgerAccount('bank-ledger-2', 'team-2', 'group-2', 'bank', 'Other checking', {linkedBankAccountId: 'bank-2'}),
    ledgerAccount('uncategorized-2', 'team-2', 'group-2', 'adjustment', 'Uncategorized', {systemKey: 'uncategorized'}),
  ])
  await db.insert(bankTransactions).values([
    bankTransaction('transaction-task', 'bank-1', '2026-07-08'),
    bankTransaction('transaction-chat', 'bank-1', '2026-07-09'),
    bankTransaction('transaction-other-team', 'bank-2', '2026-07-10'),
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
  groupId: string,
  type: string,
  name: string,
  options: {linkedBankAccountId?: string; systemKey?: string} = {},
) {
  return {
    id,
    teamId,
    groupId,
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: options.systemKey ?? null,
    type,
    normalBalance: type === 'bank' ? 'debit' : 'credit',
    name,
    description: '',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function bankTransaction(id: string, bankAccountId: string, bookingDate: string) {
  return {
    id,
    bankAccountId,
    providerTransactionId: `provider-${id}`,
    status: 'booked',
    bookingDate,
    valueDate: null,
    amount: -1_000_000,
    currency: 'DKK',
    description: 'Supermarket purchase',
    counterpartyName: 'Supermarket',
    raw: {privateProviderPayload: true},
    aiConfidence: null,
    aiReasoning: null,
    categorizationRevision: 0,
    createdAt: now,
    updatedAt: now,
  }
}
