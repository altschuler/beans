import '@tanstack/react-start/server-only'

import {defineMutator, defineMutators} from '@rocicorp/zero'
import {aiCategorizeLedgerTransactions} from '@/ledger/ai-categorization.server'
import {categorizeLedgerTransaction} from '@/ledger/categorization.server'
import {requireUserID} from './context'
import {aiCategorizeNeedsReviewBatchInput, aiCategorizeTransactionInput, categorizeTransactionInput, mutators, splitTransactionInput} from './mutators'

export const serverMutators = defineMutators(mutators, {
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await categorizeLedgerTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        ledgerTransactionId: args.ledgerTransactionId,
        accountId: args.accountId,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await categorizeLedgerTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        ledgerTransactionId: args.ledgerTransactionId,
        lines: args.lines,
      })
    }),
    aiCategorizeTransaction: defineMutator(aiCategorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await aiCategorizeLedgerTransactions(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        ledgerTransactionIds: [args.ledgerTransactionId],
      })
    }),
    aiCategorizeNeedsReviewBatch: defineMutator(aiCategorizeNeedsReviewBatchInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await aiCategorizeLedgerTransactions(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        limit: args.limit,
      })
    }),
  },
})
