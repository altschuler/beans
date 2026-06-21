import '@tanstack/react-start/server-only'

import {defineMutator, defineMutators} from '@rocicorp/zero'
import {categorizeBankTransaction, clearLedgerCategorizations, confirmLedgerTransaction, splitBankTransaction} from '@/ledger/categorization.server'
import {requireUserID} from './context'
import {categorizeTransactionInput, clearCategorizationsInput, confirmTransactionInput, mutators, splitTransactionInput} from './mutators'

export const serverMutators = defineMutators(mutators, {
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await categorizeBankTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        selection: args.selection,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await splitBankTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        lines: args.lines,
      })
    }),
    confirmTransaction: defineMutator(confirmTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await confirmLedgerTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        ledgerTransactionId: args.ledgerTransactionId,
      })
    }),
    clearCategorizations: defineMutator(clearCategorizationsInput, async ({ctx, tx}) => {
      if (tx.location !== 'server') return
      await clearLedgerCategorizations(tx.dbTransaction.wrappedTransaction, {userId: requireUserID(ctx)})
    }),
  },
})
