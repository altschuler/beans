import {validateBankLinkedCategorizationLines, type CategorizationLineInput} from '@/ledger/categorization'
import {runZeroMutation} from '@/lib/run-mutation'
import {showErrorToast} from '@/lib/show-error-toast'
import {mutators} from '@/zero/mutators'

type SplitTransactionMutation = ReturnType<typeof mutators.ledger.splitTransaction>
type MutationResult = Promise<unknown> | {server: Promise<unknown>}

type SaveDashboardSplitTransactionInput = {
  bankTransactionId: string
  bankAmount: number
  lines: CategorizationLineInput[]
  mutate: (mutation: SplitTransactionMutation) => MutationResult
}

/** Returns true when the split was accepted locally; server failures are toasted in the background. */
export function saveDashboardSplitTransaction({bankTransactionId, bankAmount, lines, mutate}: SaveDashboardSplitTransactionInput): boolean {
  try {
    validateBankLinkedCategorizationLines({bankAmount, lines})
  } catch (error) {
    showErrorToast(error, 'Could not save split')
    return false
  }

  void runZeroMutation(mutate(mutators.ledger.splitTransaction({bankTransactionId, lines})), 'Could not save split')
  return true
}
