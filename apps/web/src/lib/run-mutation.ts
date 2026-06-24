import {showErrorToast} from '@/lib/show-error-toast'

// A Zero custom mutator call returns `{client, server}` promises. Crucially, those
// promises RESOLVE with a result detail — they do not reject on failure: a server-side
// error resolves `.server` with `{type: 'error', error: {...}}` (Zero also logs it to
// the console). Awaiting the mutation alone therefore never surfaces the error, which is
// why failures were silently swallowed. Zero exposes no global per-mutation error event,
// so this is the single place we observe a mutation's outcome and notify the user.
type MutationResult = Promise<unknown> | {server: Promise<unknown>}

type MutationErrorDetail = {type?: 'app' | 'zero'; message?: string}

/**
 * Observes a Zero mutation, showing an error toast if it fails.
 *
 * Prefer fire-and-forget (`void runZeroMutation(...)`) for normal Zero-backed UI so the
 * optimistic client write drives the experience. Await the boolean only for flows that
 * genuinely need server acknowledgement before continuing.
 */
export async function runZeroMutation(result: MutationResult, errorMessage: string): Promise<boolean> {
  try {
    const details = await ('server' in result ? result.server : result)
    const error = getMutationError(details)
    if (!error) return true
    // App errors carry an intentional, user-facing message; infra ("zero") errors fall back to errorMessage.
    showErrorToast(error.type === 'app' && error.message ? new Error(error.message) : undefined, errorMessage)
    return false
  } catch (error) {
    // Defensive: a rejected promise (e.g. a client-side mutator throwing) lands here.
    showErrorToast(error, errorMessage)
    return false
  }
}

function getMutationError(details: unknown): MutationErrorDetail | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  if ((details as {type?: unknown}).type !== 'error') return undefined
  return (details as {error?: MutationErrorDetail}).error ?? {type: 'zero'}
}
