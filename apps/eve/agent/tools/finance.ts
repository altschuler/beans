import {defineDynamic, defineTool} from 'eve/tools'
import {glob, grep, readFile, writeFile} from 'eve/tools/defaults'
import {
  applyCategorizationSuggestionInputSchema,
  applyCategorizationsInputSchema,
  getBankTransactionDetailInputSchema,
  manageCategoryInputSchema,
  searchBankTransactionsInputSchema,
  searchLedgerAccountsInputSchema,
  searchLedgerTransactionsInputSchema,
} from '../lib/finance-schemas'
import {
  runApplyCategorizationSuggestion,
  runApplyCategorizations,
  runGetBankTransactionDetail,
  runManageCategory,
  runSearchBankTransactions,
  runSearchLedgerAccounts,
  runSearchLedgerTransactions,
} from '../lib/finance-capabilities'
import {requireChatRuntimeScope, requireRuntimeScope} from '../lib/runtime-scope'

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => {
      const scope = requireRuntimeScope(ctx)
      const sharedTools = {
        searchBankTransactions: defineTool({
          description: 'Search trusted-team bank transactions with compact categorization context. Internal ids are for follow-up tool calls only and must not appear in normal user-facing text.',
          inputSchema: searchBankTransactionsInputSchema,
          async execute(input, toolCtx) {
            return runSearchBankTransactions(input, requireRuntimeScope(toolCtx))
          },
        }),
        getBankTransactionDetail: defineTool({
          description: 'Read allowlisted detail for one trusted-team bank transaction, including its interpretation, postings, and current categorization revision. Provider raw payloads are never returned.',
          inputSchema: getBankTransactionDetailInputSchema,
          async execute(input, toolCtx) {
            return runGetBankTransactionDetail(input, requireRuntimeScope(toolCtx))
          },
        }),
        searchLedgerTransactions: defineTool({
          description: 'Search trusted-team ledger history for confirmed examples, split patterns, and transfer context. Internal ids are for follow-up tool calls only.',
          inputSchema: searchLedgerTransactionsInputSchema,
          async execute(input, toolCtx) {
            return runSearchLedgerTransactions(input, requireRuntimeScope(toolCtx))
          },
        }),
        searchLedgerAccounts: defineTool({
          description: 'Search trusted-team ledger accounts and category groups. Use eligibleCategoryOnly for valid category choices. Internal ids are for follow-up tool calls only.',
          inputSchema: searchLedgerAccountsInputSchema,
          async execute(input, toolCtx) {
            return runSearchLedgerAccounts(input, requireRuntimeScope(toolCtx))
          },
        }),
      }

      if (scope.purpose === 'categorization-task') {
        return {
          ...sharedTools,
          applyCategorizationSuggestion: defineTool({
            description: 'Apply one autonomous categorization result through guarded domain services. Requires the current categorization revision and returns structured conflict or rejection results; never retry a conflict without re-reading.',
            inputSchema: applyCategorizationSuggestionInputSchema,
            async execute(input, toolCtx) {
              return runApplyCategorizationSuggestion(input, requireRuntimeScope(toolCtx), {
                sessionId: toolCtx.session.id,
                callId: toolCtx.callId,
              })
            },
          }),
        }
      }

      return {
        ...sharedTools,
        applyCategorizations: defineTool({
          description: 'Atomically apply one or more manual, user-confirmed categorization changes only after a concrete proposal received a separate natural confirmation. Every row requires its current categorization revision; one rejection or conflict rolls back the whole batch.',
          inputSchema: applyCategorizationsInputSchema,
          async execute(input, toolCtx) {
            return runApplyCategorizations(input, requireChatRuntimeScope(toolCtx), {
              sessionId: toolCtx.session.id,
              callId: toolCtx.callId,
            })
          },
        }),
        manageCategory: defineTool({
          description: 'Create, update, move, or delete exactly one editable category or category group only after a concrete proposal received a separate natural confirmation.',
          inputSchema: manageCategoryInputSchema,
          async execute(input, toolCtx) {
            return runManageCategory(input, requireChatRuntimeScope(toolCtx), {
              sessionId: toolCtx.session.id,
              callId: toolCtx.callId,
            })
          },
        }),
        read_file: defineTool({
          ...readFile,
          async execute(input, toolCtx) {
            requireChatRuntimeScope(toolCtx)
            return readFile.execute(input, toolCtx)
          },
        }),
        write_file: defineTool({
          ...writeFile,
          async execute(input, toolCtx) {
            requireChatRuntimeScope(toolCtx)
            return writeFile.execute(input, toolCtx)
          },
        }),
        glob: defineTool({
          ...glob,
          async execute(input, toolCtx) {
            requireChatRuntimeScope(toolCtx)
            return glob.execute(input, toolCtx)
          },
        }),
        grep: defineTool({
          ...grep,
          async execute(input, toolCtx) {
            requireChatRuntimeScope(toolCtx)
            return grep.execute(input, toolCtx)
          },
        }),
      }
    },
  },
})
