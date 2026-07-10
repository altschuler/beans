import {and, eq, inArray, isNull} from 'drizzle-orm'
import type {Database} from './db'
import {
  applyCategorizationsInputSchema,
  manageCategoryInputSchema,
  safeChatProposalLimits,
  safeChatProposalSchema,
  type SafeChatProposal,
} from './eve-chat-approval'
import {parseDecimalMoneyToAmount} from './money'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts} from './schema'
import type {TrustedTeamScope} from './team-scope'

type ReadExecutor = Pick<Database, 'select'>

export type ChatApprovalProposalResult =
  | {status: 'ready'; proposal: SafeChatProposal}
  | {status: 'blocked'}

type ResolveInput = {
  scope: TrustedTeamScope
  toolName: string
  input: unknown
}

export async function resolveChatApprovalProposal(
  tx: ReadExecutor,
  input: ResolveInput,
): Promise<ChatApprovalProposalResult> {
  try {
    const proposal = input.toolName === 'applyCategorizations'
      ? await resolveCategorizations(tx, input.scope, input.input)
      : input.toolName === 'manageCategory'
        ? await resolveCategoryManagement(tx, input.scope, input.input)
        : null
    if (!proposal) return {status: 'blocked'}
    const parsed = safeChatProposalSchema.safeParse(proposal)
    return parsed.success ? {status: 'ready', proposal: parsed.data} : {status: 'blocked'}
  } catch {
    // Approval projection is fail-closed: malformed money or a read failure must never expose
    // raw input or produce a partial proposal that could still be approved.
    return {status: 'blocked'}
  }
}

async function resolveCategorizations(tx: ReadExecutor, scope: TrustedTeamScope, rawInput: unknown) {
  const parsed = applyCategorizationsInputSchema.safeParse(rawInput)
  if (!parsed.success || parsed.data.categorizations.length > safeChatProposalLimits.categorizationItems) return null
  if (parsed.data.categorizations.some(item => item.interpretation.kind === 'split' && item.interpretation.lines.length > safeChatProposalLimits.splitLines)) return null

  const transactionIds = [...new Set(parsed.data.categorizations.map(item => item.bankTransactionId))]
  const transactions = await tx
    .select({
      id: bankTransactions.id,
      date: bankTransactions.bookingDate,
      valueDate: bankTransactions.valueDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      description: bankTransactions.description,
      counterpartyName: bankTransactions.counterpartyName,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(bankAccounts.teamId, scope.teamId), inArray(bankTransactions.id, transactionIds)))
  const transactionsById = new Map(transactions.map(transaction => [transaction.id, transaction]))
  if (transactionsById.size !== transactionIds.length) return null

  const categoryIds = [...new Set(parsed.data.categorizations.flatMap(item => {
    if (item.interpretation.kind === 'category') return [item.interpretation.categoryAccountId]
    if (item.interpretation.kind === 'split') return item.interpretation.lines.map(line => line.categoryAccountId)
    return []
  }))]
  const transferIds = [...new Set(parsed.data.categorizations.flatMap(item =>
    item.interpretation.kind === 'transfer' ? [item.interpretation.transferLedgerAccountId] : [],
  ))]

  const [categories, transfers] = await Promise.all([
    categoryIds.length === 0 ? [] : tx
      .select({id: ledgerAccounts.id, name: ledgerAccounts.name})
      .from(ledgerAccounts)
      .where(and(
        eq(ledgerAccounts.teamId, scope.teamId),
        inArray(ledgerAccounts.id, categoryIds),
        eq(ledgerAccounts.status, 'active'),
        isNull(ledgerAccounts.systemKey),
        isNull(ledgerAccounts.linkedBankAccountId),
        inArray(ledgerAccounts.type, ['expense', 'income', 'savings']),
      )),
    transferIds.length === 0 ? [] : tx
      .select({id: ledgerAccounts.id, name: bankAccounts.name})
      .from(ledgerAccounts)
      .innerJoin(bankAccounts, eq(bankAccounts.id, ledgerAccounts.linkedBankAccountId))
      .where(and(
        eq(ledgerAccounts.teamId, scope.teamId),
        eq(bankAccounts.teamId, scope.teamId),
        inArray(ledgerAccounts.id, transferIds),
        eq(ledgerAccounts.type, 'bank'),
        eq(ledgerAccounts.status, 'active'),
      )),
  ])
  const categoryNames = new Map(categories.map(account => [account.id, account.name]))
  const transferNames = new Map(transfers.map(account => [account.id, account.name]))
  if (categoryNames.size !== categoryIds.length || transferNames.size !== transferIds.length) return null

  const items = []
  for (const categorization of parsed.data.categorizations) {
    const transaction = transactionsById.get(categorization.bankTransactionId)
    const transactionDate = transaction?.date ?? transaction?.valueDate
    if (!transaction || !transactionDate) return null
    let proposal
    if (categorization.interpretation.kind === 'category') {
      const categoryName = categoryNames.get(categorization.interpretation.categoryAccountId)
      if (!categoryName) return null
      proposal = {kind: 'category' as const, categoryName}
    } else if (categorization.interpretation.kind === 'split') {
      const lines = []
      for (const line of categorization.interpretation.lines) {
        const categoryName = categoryNames.get(line.categoryAccountId)
        if (!categoryName) return null
        lines.push({categoryName, amount: parseDecimalMoneyToAmount(line.amount)})
      }
      proposal = {kind: 'split' as const, lines}
    } else {
      const transferAccountName = transferNames.get(categorization.interpretation.transferLedgerAccountId)
      if (!transferAccountName) return null
      proposal = {kind: 'transfer' as const, transferAccountName}
    }
    items.push({
      date: transactionDate,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      ...(transaction.counterpartyName ? {counterpartyName: transaction.counterpartyName} : {}),
      proposal,
    })
  }
  return {kind: 'applyCategorizations' as const, itemCount: items.length, items}
}

async function resolveCategoryManagement(tx: ReadExecutor, scope: TrustedTeamScope, rawInput: unknown) {
  const parsed = manageCategoryInputSchema.safeParse(rawInput)
  if (!parsed.success) return null
  const operation = parsed.data.operation

  if (operation.kind === 'createGroup') {
    return {kind: 'manageCategory' as const, operation: {kind: 'createGroup' as const, newName: operation.name}}
  }
  if (operation.kind === 'updateGroup' || operation.kind === 'deleteGroup') {
    const group = await loadEditableGroup(tx, scope.teamId, operation.groupId)
    if (!group || group.name !== operation.expectedName) return null
    return {
      kind: 'manageCategory' as const,
      operation: operation.kind === 'updateGroup'
        ? {kind: 'updateGroup' as const, currentName: group.name, newName: operation.name}
        : {kind: 'deleteGroup' as const, currentName: group.name},
    }
  }
  if (operation.kind === 'createCategory') {
    const group = await loadEditableGroup(tx, scope.teamId, operation.groupId)
    if (!group) return null
    return {
      kind: 'manageCategory' as const,
      operation: {
        kind: 'createCategory' as const,
        newName: operation.name,
        description: operation.description.trim(),
        type: operation.type,
        groupName: group.name,
      },
    }
  }

  const account = await loadEditableAccount(tx, scope.teamId, operation.accountId)
  if (!account || account.name !== operation.expectedName) return null
  if (operation.kind === 'deleteCategory') {
    return {
      kind: 'manageCategory' as const,
      operation: {kind: 'deleteCategory' as const, currentName: account.name, groupName: account.groupName},
    }
  }
  const destination = await loadEditableGroup(tx, scope.teamId, operation.groupId)
  if (!destination) return null
  return {
    kind: 'manageCategory' as const,
    operation: {
      kind: 'updateCategory' as const,
      currentName: account.name,
      newName: operation.name,
      description: operation.description.trim(),
      type: operation.type,
      groupName: destination.name,
    },
  }
}

async function loadEditableGroup(tx: ReadExecutor, teamId: string, groupId: string) {
  const [group] = await tx
    .select({name: ledgerAccountGroups.name})
    .from(ledgerAccountGroups)
    .where(and(eq(ledgerAccountGroups.id, groupId), eq(ledgerAccountGroups.teamId, teamId), isNull(ledgerAccountGroups.systemKey)))
    .limit(1)
  return group ?? null
}

async function loadEditableAccount(tx: ReadExecutor, teamId: string, accountId: string) {
  const [account] = await tx
    .select({name: ledgerAccounts.name, groupName: ledgerAccountGroups.name})
    .from(ledgerAccounts)
    .innerJoin(ledgerAccountGroups, eq(ledgerAccountGroups.id, ledgerAccounts.groupId))
    .where(and(
      eq(ledgerAccounts.id, accountId),
      eq(ledgerAccounts.teamId, teamId),
      eq(ledgerAccountGroups.teamId, teamId),
      isNull(ledgerAccounts.systemKey),
      isNull(ledgerAccounts.linkedBankAccountId),
      inArray(ledgerAccounts.type, ['expense', 'income', 'savings']),
    ))
    .limit(1)
  return account ?? null
}
