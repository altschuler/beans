import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import {defineMutator, defineMutators} from '@rocicorp/zero'
import {categorizeBankTransaction, clearLedgerCategorizations, confirmBankTransactionInterpretation, splitBankTransaction} from '@penge/domain/categorization-service'
import {teamDataAssistantChats, teamMembers} from '@penge/domain/schema'
import {createManualBankAccount, createManualTransaction} from '@/banking/repository.server'
import {setBankAccountStartingBalance} from '@/banking/starting-balance.server'
import {
  createCategoryAccount,
  createCategoryGroup,
  deleteCategoryAccount,
  deleteCategoryGroup,
  updateCategoryAccount,
  updateCategoryGroup,
} from '@penge/domain/category-management'
import {requireUserID} from './context'
import {
  categorizeTransactionInput,
  clearCategorizationsInput,
  confirmTransactionInput,
  createCategoryAccountInput,
  createCategoryGroupInput,
  createManualBankAccountInput,
  createManualTransactionInput,
  createTeamDataAssistantChatInput,
  setStartingBalanceInput,
  deleteCategoryAccountInput,
  deleteCategoryGroupInput,
  mutators,
  splitTransactionInput,
  touchTeamDataAssistantChatInput,
  updateCategoryAccountInput,
  updateCategoryGroupInput,
} from './mutators'

type CategorizationTransaction = Parameters<typeof categorizeBankTransaction>[0]
type CategoryManagementTransaction = Parameters<typeof createCategoryAccount>[0]
type BankingTransaction = Parameters<typeof createManualBankAccount>[0]

type ChatHistoryTransaction = CategoryManagementTransaction

async function requireTeamAccess(transaction: ChatHistoryTransaction, teamId: string, userId: string) {
  const [membership] = await transaction
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Team not found')
}

function dateFromEpoch(value: number) {
  return new Date(value)
}

export const serverMutators = defineMutators(mutators, {
  flue: {
    createTeamDataAssistantChat: defineMutator(createTeamDataAssistantChatInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const userId = requireUserID(ctx)
      if (args.userId !== userId) throw new Error('Unauthorized')
      const transaction = tx.dbTransaction.wrappedTransaction as ChatHistoryTransaction
      await requireTeamAccess(transaction, args.teamId, userId)
      const [existing] = await transaction
        .select({id: teamDataAssistantChats.id, teamId: teamDataAssistantChats.teamId, userId: teamDataAssistantChats.userId, firstSubmittedAt: teamDataAssistantChats.firstSubmittedAt})
        .from(teamDataAssistantChats)
        .where(eq(teamDataAssistantChats.id, args.id))
        .limit(1)

      if (existing) {
        if (existing.teamId !== args.teamId || existing.userId !== userId) throw new Error('Chat not found')
        await transaction
          .update(teamDataAssistantChats)
          .set({
            updatedAt: dateFromEpoch(args.updatedAt),
            lastUsedAt: dateFromEpoch(args.lastUsedAt),
            ...(args.firstSubmittedAt && !existing.firstSubmittedAt ? {firstSubmittedAt: dateFromEpoch(args.firstSubmittedAt)} : {}),
            ...(Object.hasOwn(args, 'currentPage') ? {currentPage: args.currentPage ?? null} : {}),
          })
          .where(eq(teamDataAssistantChats.id, args.id))
        return
      }

      await transaction.insert(teamDataAssistantChats).values({
        id: args.id,
        teamId: args.teamId,
        userId,
        createdAt: dateFromEpoch(args.createdAt),
        updatedAt: dateFromEpoch(args.updatedAt),
        lastUsedAt: dateFromEpoch(args.lastUsedAt),
        firstSubmittedAt: args.firstSubmittedAt ? dateFromEpoch(args.firstSubmittedAt) : null,
        currentPage: args.currentPage ?? null,
      })
    }),
    touchTeamDataAssistantChat: defineMutator(touchTeamDataAssistantChatInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const userId = requireUserID(ctx)
      const transaction = tx.dbTransaction.wrappedTransaction as ChatHistoryTransaction
      const [chat] = await transaction
        .select({id: teamDataAssistantChats.id, teamId: teamDataAssistantChats.teamId, userId: teamDataAssistantChats.userId, firstSubmittedAt: teamDataAssistantChats.firstSubmittedAt})
        .from(teamDataAssistantChats)
        .where(and(eq(teamDataAssistantChats.id, args.chatId), eq(teamDataAssistantChats.userId, userId)))
        .limit(1)
      if (!chat) throw new Error('Chat not found')
      await requireTeamAccess(transaction, chat.teamId, userId)

      await transaction
        .update(teamDataAssistantChats)
        .set({
          updatedAt: dateFromEpoch(args.lastUsedAt),
          lastUsedAt: dateFromEpoch(args.lastUsedAt),
          ...(args.firstSubmittedAt && !chat.firstSubmittedAt ? {firstSubmittedAt: dateFromEpoch(args.firstSubmittedAt)} : {}),
          ...(Object.hasOwn(args, 'currentPage') ? {currentPage: args.currentPage ?? null} : {}),
        })
        .where(eq(teamDataAssistantChats.id, args.chatId))
    }),
  },
  banking: {
    createManualBankAccount: defineMutator(createManualBankAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as BankingTransaction
      const {bankLedgerGroupId: _bankLedgerGroupId, ...commandInput} = args
      await createManualBankAccount(transaction, {...commandInput, userId: requireUserID(ctx)})
    }),
    createManualTransaction: defineMutator(createManualTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as BankingTransaction
      await createManualTransaction(transaction, {...args, userId: requireUserID(ctx)})
    }),
    setStartingBalance: defineMutator(setStartingBalanceInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as BankingTransaction
      await setBankAccountStartingBalance(transaction, {...args, userId: requireUserID(ctx)})
    }),
  },
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await categorizeBankTransaction(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        selection: args.selection,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await splitBankTransaction(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        lines: args.lines,
      })
    }),
    confirmTransaction: defineMutator(confirmTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await confirmBankTransactionInterpretation(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
      })
    }),
    clearCategorizations: defineMutator(clearCategorizationsInput, async ({ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await clearLedgerCategorizations(transaction, {userId: requireUserID(ctx)})
    }),
    createCategoryAccount: defineMutator(createCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await createCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryAccount: defineMutator(updateCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await updateCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryAccount: defineMutator(deleteCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await deleteCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    createCategoryGroup: defineMutator(createCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await createCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryGroup: defineMutator(updateCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await updateCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryGroup: defineMutator(deleteCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await deleteCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
  },
})
