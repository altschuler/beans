import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, expectTypeOf, it} from 'vitest'
import {DialogProvider, useDialog} from '@/hooks/use-dialogs'
import type {DialogControls, InferDialogOwnProps, InferDialogResult} from '@/hooks/use-dialogs'

function DialogStatus() {
  const {hasOpenDialogs} = useDialog()
  return <span>{hasOpenDialogs ? 'open' : 'closed'}</span>
}

describe('useDialog', () => {
  it('requires callers to render within DialogProvider', () => {
    expect(() => renderToStaticMarkup(<DialogStatus />)).toThrowError('useDialog must be used within a DialogProvider.')
  })

  it('provides closed initial dialog state through the provider', () => {
    const markup = renderToStaticMarkup(
      <DialogProvider>
        <DialogStatus />
      </DialogProvider>,
    )

    expect(markup).toContain('closed')
  })

  it('infers dialog result and own props for generic dialogs', () => {
    type TypedDialogProps = {
      title: string
      optionalCount?: number
    } & DialogControls<{accepted: true}>

    const TypedDialog = (props: TypedDialogProps) => {
      void props
      return null
    }

    expectTypeOf<InferDialogResult<typeof TypedDialog>>().toEqualTypeOf<{accepted: true}>()
    expectTypeOf<InferDialogOwnProps<typeof TypedDialog>>().toEqualTypeOf<{
      title: string
      optionalCount?: number
    }>()

    function TypeProbe() {
      const {showDialog} = useDialog()
      const UntypedDialog = (props: {title: string}) => {
        void props
        return null
      }

      void showDialog(TypedDialog, {title: 'Hello'}).then((result) => {
        expectTypeOf(result).toEqualTypeOf<{accepted: true} | undefined>()
      })

      // @ts-expect-error title is required
      void showDialog(TypedDialog, {})

      // @ts-expect-error controls are internal and cannot be passed as own props
      void showDialog(TypedDialog, {title: 'Hello', open: true})

      // @ts-expect-error showDialog only accepts dialogs with DialogControls
      void showDialog(UntypedDialog, {title: 'Hello'})

      return null
    }

    expect(TypeProbe).toBeTypeOf('function')
  })
})
