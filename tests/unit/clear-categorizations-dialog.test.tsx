// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {ClearCategorizationsDialog} from '@/components/dialogs'

const zeroMutate = vi.hoisted(() => vi.fn(() => ({server: new Promise(() => undefined)})))
const clearCategorizations = vi.hoisted(() => vi.fn((input) => ({type: 'clearCategorizations', input})))
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock('@rocicorp/zero/react', () => ({
  useZero: () => ({mutate: zeroMutate}),
}))

vi.mock('sonner', () => ({
  toast: {success: toastSuccess},
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      clearCategorizations,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClearCategorizationsDialog', () => {
  it('clears categorizations and resolves true when the destructive action is confirmed', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    render(<ClearCategorizationsDialog open close={close} dismiss={vi.fn()} />)

    expect(screen.getByText(/Imported bank transactions will be kept/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', {name: 'Clear all categorizations'}))

    expect(clearCategorizations).toHaveBeenCalledWith({})
    expect(zeroMutate).toHaveBeenCalledWith({type: 'clearCategorizations', input: {}})
    expect(toastSuccess).toHaveBeenCalledWith('Cleared ledger categorizations. Imported bank transactions were kept.')
    expect(close).toHaveBeenCalledWith(true)
  })

  it('dismisses without confirming from the cancel action', async () => {
    const user = userEvent.setup()
    const dismiss = vi.fn()
    render(<ClearCategorizationsDialog open close={vi.fn()} dismiss={dismiss} />)

    await user.click(screen.getByRole('button', {name: 'Cancel'}))

    expect(dismiss).toHaveBeenCalledOnce()
  })
})
