/* eslint-disable react-hooks/refs -- Dialog callbacks read refs for promise lifecycles and are only invoked after render. */
import {createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import type {ComponentType, ReactNode} from 'react'

export const DIALOG_ANIMATION_TIMEOUT_MS = 200

export type DialogControls<TResult> = {
  open: boolean
  close: (result: TResult) => void
  dismiss: () => void
}

// Type circus here enables type-safe dialog component usage in showDialog.
type AnyDialogComponent = ComponentType<Record<string, unknown>>

type DialogControlKey = keyof DialogControls<unknown>

type InferDialogProps<TDialog> = TDialog extends ComponentType<infer TProps> ? TProps : never

export type InferDialogResult<TDialog> = InferDialogProps<TDialog> extends DialogControls<infer TResult> ? TResult : never

export type InferDialogOwnProps<TDialog> = [InferDialogResult<TDialog>] extends [never]
  ? never
  : Omit<InferDialogProps<TDialog>, DialogControlKey>

export type ShowDialog = <TDialog>(
  dialog: [InferDialogResult<TDialog>] extends [never] ? never : TDialog,
  props: InferDialogOwnProps<TDialog>,
) => Promise<InferDialogResult<TDialog> | undefined>

type DialogContextValue = {
  hasOpenDialogs: boolean
  showDialog: ShowDialog
}

type DialogEntry = {
  id: number
  component: AnyDialogComponent
  props: Record<string, unknown>
  open: boolean
}

type DialogLifecycle = {
  resolve: (value: unknown) => void
  phase: 'open' | 'closing'
  timeoutId?: ReturnType<typeof setTimeout>
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function useDialog() {
  const context = useContext(DialogContext)

  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider.')
  }

  return context
}

export function DialogProvider({children}: {children: ReactNode}) {
  const nextId = useRef(0)
  const [dialogs, setDialogs] = useState<DialogEntry[]>([])
  const dialogLifecycles = useRef<Map<number, DialogLifecycle>>(new Map())

  const hasOpenDialogs = useMemo(() => dialogs.some((dialog) => dialog.open), [dialogs])

  const settleDialog = useCallback((id: number, value: unknown) => {
    const lifecycle = dialogLifecycles.current.get(id)
    if (!lifecycle || lifecycle.phase !== 'open') {
      return
    }

    lifecycle.phase = 'closing'
    lifecycle.resolve(value)

    setDialogs((currentDialogs) =>
      currentDialogs.map((dialog) => {
        if (dialog.id !== id) {
          return dialog
        }

        return {
          ...dialog,
          open: false,
        }
      }),
    )

    lifecycle.timeoutId = setTimeout(() => {
      setDialogs((currentDialogs) => currentDialogs.filter((dialog) => dialog.id !== id))
      const closingLifecycle = dialogLifecycles.current.get(id)
      if (!closingLifecycle || closingLifecycle.phase !== 'closing') {
        return
      }

      dialogLifecycles.current.delete(id)
    }, DIALOG_ANIMATION_TIMEOUT_MS)
  }, [])

  useEffect(() => {
    const lifecycles = dialogLifecycles.current

    return () => {
      for (const lifecycle of lifecycles.values()) {
        if (lifecycle.timeoutId !== undefined) {
          clearTimeout(lifecycle.timeoutId)
        }
        if (lifecycle.phase === 'open') {
          lifecycle.resolve(undefined)
        }
      }
      lifecycles.clear()
    }
  }, [])

  const showDialog: ShowDialog = useCallback((dialog, props) => {
    const id = nextId.current
    nextId.current += 1

    return new Promise((resolve) => {
      dialogLifecycles.current.set(id, {
        resolve: resolve as (value: unknown) => void,
        phase: 'open',
      })
      setDialogs((currentDialogs) => [
        ...currentDialogs,
        {
          id,
          component: dialog as AnyDialogComponent,
          props: props as Record<string, unknown>,
          open: true,
        },
      ])
    })
  }, [])

  const contextValue = useMemo(
    () => ({
      hasOpenDialogs,
      showDialog,
    }),
    [hasOpenDialogs, showDialog],
  )

  return createElement(
    DialogContext.Provider,
    {
      value: contextValue,
    },
    children,
    dialogs.map((dialog) => {
      const controls: DialogControls<unknown> = {
        open: dialog.open,
        close: (result) => {
          settleDialog(dialog.id, result)
        },
        dismiss: () => {
          settleDialog(dialog.id, undefined)
        },
      }

      return createElement(dialog.component, {
        key: dialog.id,
        ...dialog.props,
        ...controls,
      })
    }),
  )
}
