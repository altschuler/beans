import {validateBankLinkedCategorizationLines, type CategorizationLineInput} from '@/ledger/categorization'
import {mutators} from '@/zero/mutators'

type SplitTransactionMutation = ReturnType<typeof mutators.ledger.splitTransaction>
type MutationResult = Promise<unknown> | {server: Promise<unknown>}

type SaveDashboardSplitTransactionInput = {
  bankTransactionId: string
  bankAmount: string
  lines: CategorizationLineInput[]
  mutate: (mutation: SplitTransactionMutation) => MutationResult
  onSuccess: () => void
  onError: (error: unknown, fallbackMessage: string) => void
}

export async function saveDashboardSplitTransaction({
  bankTransactionId,
  bankAmount,
  lines,
  mutate,
  onSuccess,
  onError,
}: SaveDashboardSplitTransactionInput) {
  try {
    validateBankLinkedCategorizationLines({bankAmount, lines})
    await waitForMutation(mutate(mutators.ledger.splitTransaction({bankTransactionId, lines})))
    onSuccess()
  } catch (error) {
    onError(error, 'Could not save split')
  }
}

async function waitForMutation(result: MutationResult) {
  if ('server' in result) {
    await result.server
    return
  }

  await result
}
