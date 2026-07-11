import {
  CategorizationRevisionConflictError,
  categorizeBankTransaction,
  splitBankTransaction,
} from '@penge/domain/categorization-service'
import {
  CategoryNameConflictError,
  assertExpectedCategoryName,
  createCategoryAccount,
  createCategoryGroup,
  deleteCategoryAccount,
  deleteCategoryGroup,
  updateCategoryAccount,
  updateCategoryGroup,
} from '@penge/domain/category-management'
import {db, type Database} from '@penge/domain/db'
import {agentToolExecutions} from '@penge/domain/schema'
import {
  getBankTransactionDetail,
  searchBankTransactions,
  searchLedgerAccounts,
  searchLedgerTransactions,
} from '@penge/domain/read-projections'
import type {
  ApplyCategorizationsInput,
  GetBankTransactionDetailInput,
  ManageCategoryInput,
  SearchBankTransactionsInput,
  SearchLedgerAccountsInput,
  SearchLedgerTransactionsInput,
  ChatRuntimeScope,
} from './finance-schemas'

type WriteTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ChatCategorization = ApplyCategorizationsInput['categorizations'][number]
type ToolCallIdentity = {sessionId: string; callId: string}

export async function runSearchBankTransactions(input: SearchBankTransactionsInput, scope: ChatRuntimeScope) {
  return toJson(await searchBankTransactions(db, {...toolScope(scope), filters: input}))
}

export async function runGetBankTransactionDetail(input: GetBankTransactionDetailInput, scope: ChatRuntimeScope) {
  return toJson(await getBankTransactionDetail(db, {...toolScope(scope), bankTransactionId: input.bankTransactionId}))
}

export async function runSearchLedgerTransactions(input: SearchLedgerTransactionsInput, scope: ChatRuntimeScope) {
  return toJson(await searchLedgerTransactions(db, {...toolScope(scope), filters: input}))
}

export async function runSearchLedgerAccounts(input: SearchLedgerAccountsInput, scope: ChatRuntimeScope) {
  return toJson(await searchLedgerAccounts(db, {...toolScope(scope), filters: input}))
}

export async function runApplyCategorizations(
  input: ApplyCategorizationsInput,
  scope: ChatRuntimeScope,
  identity: ToolCallIdentity,
) {
  try {
    return await db.transaction(tx => replayableWrite(tx, scope, identity, 'applyCategorizations', async () => {
      const results = []
      for (const categorization of input.categorizations) {
        const result = await applyChatCategorization(tx, scope, categorization)
        if (result.status !== 'applied') throw new ChatBatchWriteError(result)
        results.push(result)
      }

      return {
        ok: true,
        status: 'completed',
        appliedCount: results.length,
        rejectedCount: 0,
        conflictCount: 0,
        results,
      } as const
    }))
  } catch (error) {
    const result = error instanceof ChatBatchWriteError
      ? error.result
      : {ok: false, status: 'rejected', error: 'Categorization batch was rejected'} as const
    return {
      ok: false,
      status: result.status,
      appliedCount: 0,
      rejectedCount: result.status === 'rejected' ? 1 : 0,
      conflictCount: result.status === 'conflict' ? 1 : 0,
      results: [result],
    } as const
  }
}

export async function runManageCategory(input: ManageCategoryInput, scope: ChatRuntimeScope, identity: ToolCallIdentity) {
  try {
    return await db.transaction(tx => replayableWrite(tx, scope, identity, 'manageCategory', async () => {
      try {
        const details = await applyCategoryManagementOperation(tx, {
          userId: scope.userId,
          teamId: scope.teamId,
          resourceId: toolResourceId(identity.sessionId, identity.callId),
          operation: input.operation,
        })
        return {ok: true, status: 'applied', ...details} as const
      } catch (error) {
        if (error instanceof CategoryNameConflictError) {
          return {ok: false, status: 'conflict', error: error.message} as const
        }
        throw error
      }
    }))
  } catch (error) {
    return {ok: false, status: 'rejected', error: safeDomainError(error, 'Category change was rejected')} as const
  }
}

async function applyChatCategorization(
  tx: WriteTransaction,
  scope: ChatRuntimeScope,
  input: ChatCategorization,
) {
  try {
    const applied = input.interpretation.kind === 'split'
      ? await splitBankTransaction(tx, {
          userId: scope.userId,
          teamId: scope.teamId,
          trustedScope: true,
          bankTransactionId: input.bankTransactionId,
          expectedCategorizationRevision: input.expectedCategorizationRevision,
          lines: input.interpretation.lines.map(line => ({accountId: line.categoryAccountId, amount: line.amount})),
        })
      : await categorizeBankTransaction(tx, {
          userId: scope.userId,
          teamId: scope.teamId,
          trustedScope: true,
          bankTransactionId: input.bankTransactionId,
          expectedCategorizationRevision: input.expectedCategorizationRevision,
          selection: input.interpretation.kind === 'category'
            ? {kind: 'category', accountId: input.interpretation.categoryAccountId}
            : {kind: 'transfer', accountId: input.interpretation.transferLedgerAccountId},
        })

    return applied
      ? {ok: true, status: 'applied', bankTransactionId: input.bankTransactionId} as const
      : {ok: false, status: 'rejected', bankTransactionId: input.bankTransactionId, error: 'Bank transaction is not writable in this chat scope'} as const
  } catch (error) {
    return categorizationErrorResult(error, input.bankTransactionId)
  }
}

async function applyCategoryManagementOperation(
  tx: WriteTransaction,
  input: {userId: string; teamId: string; resourceId: string; operation: ManageCategoryInput['operation']},
) {
  if (input.operation.kind === 'updateGroup' || input.operation.kind === 'deleteGroup') {
    await assertExpectedCategoryName(tx, {
      teamId: input.teamId,
      target: 'group',
      targetId: input.operation.groupId,
      expectedName: input.operation.expectedName,
    })
  } else if (input.operation.kind === 'updateCategory' || input.operation.kind === 'deleteCategory') {
    await assertExpectedCategoryName(tx, {
      teamId: input.teamId,
      target: 'category',
      targetId: input.operation.accountId,
      expectedName: input.operation.expectedName,
    })
  }

  if (input.operation.kind === 'createGroup') {
    const groupId = input.resourceId
    const existing = await tx.query.ledgerAccountGroups.findFirst({
      columns: {teamId: true, systemKey: true, name: true},
      where: (group, {eq}) => eq(group.id, groupId),
    })
    if (existing) {
      if (existing.teamId === input.teamId && existing.systemKey === null && existing.name === input.operation.name) return {groupId}
      throw new Error('Category change was rejected')
    }
    await createCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, trustedScope: true, id: groupId, name: input.operation.name})
    return {groupId}
  }
  if (input.operation.kind === 'updateGroup') {
    await updateCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, trustedScope: true, groupId: input.operation.groupId, name: input.operation.name})
    return {}
  }
  if (input.operation.kind === 'deleteGroup') {
    await deleteCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, trustedScope: true, groupId: input.operation.groupId})
    return {}
  }
  if (input.operation.kind === 'createCategory') {
    const accountId = input.resourceId
    const existing = await tx.query.ledgerAccounts.findFirst({
      columns: {
        teamId: true,
        groupId: true,
        linkedBankAccountId: true,
        systemKey: true,
        type: true,
        name: true,
        description: true,
      },
      where: (account, {eq}) => eq(account.id, accountId),
    })
    if (existing) {
      if (
        existing.teamId === input.teamId &&
        existing.groupId === input.operation.groupId &&
        existing.linkedBankAccountId === null &&
        existing.systemKey === null &&
        existing.type === input.operation.type &&
        existing.name === input.operation.name &&
        existing.description === input.operation.description.trim()
      ) {
        return {accountId}
      }
      throw new Error('Category change was rejected')
    }
    await createCategoryAccount(tx, {
      userId: input.userId,
      teamId: input.teamId,
      trustedScope: true,
      id: accountId,
      groupId: input.operation.groupId,
      name: input.operation.name,
      description: input.operation.description,
      type: input.operation.type,
    })
    return {accountId}
  }
  if (input.operation.kind === 'updateCategory') {
    await updateCategoryAccount(tx, {
      userId: input.userId,
      teamId: input.teamId,
      trustedScope: true,
      accountId: input.operation.accountId,
      groupId: input.operation.groupId,
      name: input.operation.name,
      description: input.operation.description,
      type: input.operation.type,
    })
    return {}
  }
  await deleteCategoryAccount(tx, {userId: input.userId, teamId: input.teamId, trustedScope: true, accountId: input.operation.accountId})
  return {}
}

async function replayableWrite<T>(
  tx: WriteTransaction,
  scope: ChatRuntimeScope,
  identity: ToolCallIdentity,
  toolName: string,
  execute: () => Promise<T>,
): Promise<T> {
  const sessionId = identity.sessionId.trim()
  const callId = identity.callId.trim()
  if (!sessionId || !callId) throw new Error('Invalid eve tool call identity')

  const existing = await tx.query.agentToolExecutions.findFirst({
    columns: {purpose: true, toolName: true, teamId: true, userId: true, result: true},
    where: (execution, {and, eq}) => and(eq(execution.eveSessionId, sessionId), eq(execution.callId, callId)),
  })
  if (existing) {
    if (
      existing.purpose !== scope.purpose ||
      existing.toolName !== toolName ||
      existing.teamId !== scope.teamId ||
      existing.userId !== scope.userId
    ) {
      throw new Error('Eve tool call identity was reused with different trusted scope')
    }
    return existing.result as T
  }

  const result = await execute()
  await tx.insert(agentToolExecutions).values({
    id: crypto.randomUUID(),
    eveSessionId: sessionId,
    callId,
    purpose: scope.purpose,
    toolName,
    teamId: scope.teamId,
    userId: scope.userId,
    result,
    createdAt: new Date(),
  })
  return result
}

function toolResourceId(sessionId: string, callId: string) {
  const normalizedSessionId = sessionId.trim()
  const normalizedCallId = callId.trim()
  if (!normalizedSessionId || !normalizedCallId) throw new Error('Invalid eve tool call identity')
  return `eve:${normalizedSessionId}:${normalizedCallId}`
}

function toolScope(scope: ChatRuntimeScope) {
  return {userId: scope.userId, teamId: scope.teamId}
}

class ChatBatchWriteError extends Error {
  constructor(readonly result: ReturnType<typeof categorizationErrorResult>) {
    super('Chat categorization batch could not be applied atomically')
  }
}

function categorizationErrorResult(error: unknown, bankTransactionId: string) {
  if (error instanceof CategorizationRevisionConflictError) {
    return {
      ok: false,
      status: 'conflict',
      bankTransactionId: error.bankTransactionId,
      expectedCategorizationRevision: error.expectedCategorizationRevision,
      actualCategorizationRevision: error.actualCategorizationRevision,
      instruction: 'Re-read the transaction before deciding whether to retry; do not blindly replay the stale interpretation.',
    } as const
  }

  return {
    ok: false,
    status: 'rejected',
    bankTransactionId,
    error: safeDomainError(error, 'Categorization was rejected'),
  } as const
}

const safeDomainErrors = new Set([
  'Bank transaction not found',
  'Bank transaction interpretation not found',
  'Invalid categorization account',
  'Invalid transfer account',
  'Invalid transfer counter transaction',
  'Cannot transfer to the same bank account',
  'No matching transfer was found',
  'Split amounts must be positive',
  'Split amounts must equal the transaction amount',
  'Category group not found',
  'Category account not found',
  'System groups cannot be edited',
  'System groups cannot be deleted',
  'System groups cannot contain user categories',
  'Move or delete categories in this group first',
  'System accounts cannot be edited',
  'Bank-linked accounts cannot be edited',
  'Invalid category account',
  'Invalid category type',
  'Categories with ledger history cannot be deleted',
])

function safeDomainError(error: unknown, fallback: string) {
  return error instanceof Error && safeDomainErrors.has(error.message) ? error.message : fallback
}

function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
