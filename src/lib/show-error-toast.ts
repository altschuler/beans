import {toast} from 'sonner'

export function showErrorToast(error: unknown, fallbackMessage: string) {
  toast.error(error instanceof Error ? error.message : fallbackMessage)
}
