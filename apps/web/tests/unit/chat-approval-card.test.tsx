// @vitest-environment jsdom
import React from 'react'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {describe, expect, it, vi} from 'vitest'
import {ChatApprovalCard} from '@/components/assistant/chat-approval-card'

const categoryProposal = {
  kind: 'manageCategory' as const,
  operation: {kind: 'updateCategory' as const, currentName: 'Meals', newName: 'Dining', description: 'Food away from home', type: 'expense' as const, groupName: 'Expenses'},
}

describe('ChatApprovalCard', () => {
  it.each([
    ['approve' as const, 'Approve proposed change'],
    ['deny' as const, 'Deny proposed change'],
  ])('submits the exact immutable %s action', async (decision, label) => {
    const onRespond = vi.fn()
    const user = userEvent.setup()
    render(<ChatApprovalCard
      approvalId="approval-1"
      requestId="request-1"
      toolCallId="call-1"
      proposal={categoryProposal}
      toolName="manageCategory"
      projectionStatus="ready"
      sessionOrdinal={3}
      currentSessionOrdinal={3}
      sessionState="waiting"
      isSubmitting={false}
      onRespond={onRespond}
    />)
    await user.click(screen.getByRole('button', {name: label}))
    expect(onRespond).toHaveBeenCalledWith({
      approvalId: 'approval-1', requestId: 'request-1', toolCallId: 'call-1', proposal: categoryProposal, sessionOrdinal: 3, decision,
    })
  })

  it('blocks stale, running, and projection-blocked approvals while retaining deny for a current blocked proposal', async () => {
    const onRespond = vi.fn()
    const {rerender} = render(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" proposal={categoryProposal}
      toolName="manageCategory"
      projectionStatus="ready" sessionOrdinal={2} currentSessionOrdinal={3} sessionState="waiting"
      isSubmitting={false} onRespond={onRespond}
    />)
    expect(screen.getByRole('button', {name: 'Approve proposed change'})).toBeDisabled()
    expect(screen.getByRole('button', {name: 'Deny proposed change'})).toBeDisabled()

    rerender(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" proposal={categoryProposal}
      toolName="manageCategory"
      projectionStatus="ready" sessionOrdinal={3} currentSessionOrdinal={3} sessionState="running"
      isSubmitting={false} onRespond={onRespond}
    />)
    expect(screen.getByRole('button', {name: 'Approve proposed change'})).toBeDisabled()

    rerender(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" proposal={null} toolName="applyCategorizations"
      projectionStatus="blocked" sessionOrdinal={3} currentSessionOrdinal={3} sessionState="waiting"
      isSubmitting={false} onRespond={onRespond}
    />)
    expect(screen.getByText('Transaction categorization')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Approve proposed change'})).toBeDisabled()
    expect(screen.getByRole('button', {name: 'Deny proposed change'})).toBeEnabled()
    expect(screen.getByText('This change cannot be safely approved. You can still deny it.')).toBeInTheDocument()
  })

  it('renders an expired approval as finalized without action controls', () => {
    render(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" proposal={categoryProposal}
      toolName="manageCategory" projectionStatus="ready" resolutionStatus="expired"
      sessionOrdinal={3} currentSessionOrdinal={3} sessionState="completed"
      isSubmitting={false} onRespond={vi.fn()}
    />)

    expect(screen.getByText('This approval expired when the chat session ended.')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Approve proposed change'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Deny proposed change'})).not.toBeInTheDocument()
  })

  it('renders every category update field without truncation', () => {
    render(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" proposal={categoryProposal} toolName="manageCategory"
      projectionStatus="ready" sessionOrdinal={3} currentSessionOrdinal={3} sessionState="waiting"
      isSubmitting={false} onRespond={vi.fn()}
    />)
    expect(screen.getByText('Meals')).toBeInTheDocument()
    expect(screen.getByText('Dining')).toBeInTheDocument()
    expect(screen.getByText('Food away from home')).toBeInTheDocument()
    expect(screen.getByText('Expenses')).toBeInTheDocument()
    expect(screen.getByText('expense')).toBeInTheDocument()
  })

  it('renders full transaction identity and split amounts in the transaction currency', () => {
    render(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1" toolName="applyCategorizations"
      proposal={{kind: 'applyCategorizations', itemCount: 1, items: [{
        date: '2026-07-10', amount: -123400, currency: 'DKK', description: 'A deliberately complete lunch description', counterpartyName: 'Cafe Complete',
        proposal: {kind: 'split', lines: [{categoryName: 'Dining', amount: 100000}, {categoryName: 'Tips', amount: 23400}]},
      }]}}
      projectionStatus="ready" sessionOrdinal={3} currentSessionOrdinal={3} sessionState="waiting"
      isSubmitting={false} onRespond={vi.fn()}
    />)
    expect(screen.getByText('A deliberately complete lunch description')).toBeInTheDocument()
    expect(screen.getByText('Cafe Complete')).toBeInTheDocument()
    expect(screen.getByText('10.00 DKK')).toBeInTheDocument()
    expect(screen.getByText('2.34 DKK')).toBeInTheDocument()
  })

  it('renders a bounded transaction categorization without generic media or URLs and disables immediately while submitting', () => {
    render(<ChatApprovalCard
      approvalId="approval-1" requestId="request-1" toolCallId="call-1"
      toolName="applyCategorizations"
      proposal={{kind: 'applyCategorizations', itemCount: 1, items: [{date: '2026-07-10', amount: -123400, currency: 'DKK', description: 'Lunch', proposal: {kind: 'category', categoryName: 'Dining'}}]}}
      projectionStatus="ready" sessionOrdinal={3} currentSessionOrdinal={3} sessionState="waiting"
      isSubmitting submittingDecision="approve" onRespond={vi.fn()}
    />)
    expect(screen.getByText('Transaction categorization')).toBeInTheDocument()
    expect(screen.getByText('-12.34 DKK')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Approve proposed change'})).toHaveTextContent('Approving…')
    expect(screen.getByRole('button', {name: 'Approve proposed change'})).toBeDisabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
