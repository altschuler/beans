import {describe, expect, it} from 'vitest'
import {asQueryInternals} from '@rocicorp/zero/bindings'
import type {AST, Condition, AnyQuery} from '@rocicorp/zero'
import {queries} from '@/zero/queries'
import {zeroContextFor} from '../helpers/zero'

function astFor(query: unknown) {
  return asQueryInternals(query as AnyQuery).ast
}

describe('Zero ledger query shapes', () => {
  it('narrows ledger account detail by account id while retaining team authorization and related data', () => {
    const ast = astFor(queries.domain.ledgerAccountDetail.fn({ctx: zeroContextFor('user-1'), args: {accountId: 'account-1'}}))

    expect(ast.table).toBe('ledgerAccounts')
    expect(conditionIncludesSimple(ast.where, 'id', 'account-1')).toBe(true)
    expect(conditionHasExistsPath(ast.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const group = relatedSubquery(ast, 'group')
    const postings = relatedSubquery(ast, 'postings')
    expect(group).toBeDefined()
    expect(conditionHasExistsPath(group?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    expect(postings).toBeDefined()

    const bankTransaction = relatedSubquery(postings, 'bankTransaction')
    expect(bankTransaction).toBeDefined()
    expect(conditionHasExistsPath(bankTransaction?.where, ['bankAccount', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const ledgerTransaction = relatedSubquery(postings, 'ledgerTransaction')
    expect(ledgerTransaction).toBeDefined()
    expect(conditionHasExistsPath(ledgerTransaction?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const transactionPostings = relatedSubquery(ledgerTransaction, 'postings')
    expect(transactionPostings).toBeDefined()
    const transactionPostingBankTransaction = relatedSubquery(transactionPostings, 'bankTransaction')
    expect(transactionPostingBankTransaction).toBeDefined()
    expect(conditionHasExistsPath(transactionPostingBankTransaction?.where, ['bankAccount', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
  })

  it('loads dashboard accounts with authorized postings for balances without broad posting reads', () => {
    const ast = astFor(queries.domain.ledgerAccountsForDashboard.fn({ctx: zeroContextFor('user-1'), args: undefined}))

    expect(ast.table).toBe('ledgerAccounts')
    expect(conditionHasExistsPath(ast.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    const postings = relatedSubquery(ast, 'postings')
    expect(postings).toBeDefined()
    expect(conditionHasExistsPath(postings?.where, ['ledgerTransaction', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
  })

  it('loads dashboard bank transactions with authorized ledger interpretation relationships', () => {
    const ast = astFor(queries.domain.bankTransactionsForDashboard.fn({ctx: zeroContextFor('user-1'), args: undefined}))

    expect(ast.table).toBe('bankTransactions')
    expect(conditionHasExistsPath(ast.where, ['bankAccount', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    const posting = relatedSubquery(ast, 'posting')
    expect(posting).toBeDefined()
    expect(conditionHasExistsPath(posting?.where, ['ledgerTransaction', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    const ledgerTransaction = relatedSubquery(posting, 'ledgerTransaction')
    expect(ledgerTransaction).toBeDefined()
    expect(conditionHasExistsPath(ledgerTransaction?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    const postings = relatedSubquery(ledgerTransaction, 'postings')
    expect(postings).toBeDefined()
    const account = relatedSubquery(postings, 'account')
    expect(account).toBeDefined()
    expect(conditionHasExistsPath(account?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
  })

  it('loads ledger postings with their account, ledger transaction, and bank transaction relationships', () => {
    const ast = astFor(queries.domain.ledgerPostingsWithRelations.fn({ctx: zeroContextFor('user-1'), args: undefined}))

    expect(ast.table).toBe('ledgerPostings')
    expect(conditionHasExistsPath(ast.where, ['ledgerTransaction', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
    const account = relatedSubquery(ast, 'account')
    expect(account).toBeDefined()
    expect(conditionHasExistsPath(account?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const ledgerTransaction = relatedSubquery(ast, 'ledgerTransaction')
    expect(ledgerTransaction).toBeDefined()
    expect(conditionHasExistsPath(ledgerTransaction?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const bankTransaction = relatedSubquery(ast, 'bankTransaction')
    expect(bankTransaction).toBeDefined()
    expect(conditionHasExistsPath(bankTransaction?.where, ['bankAccount', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
  })

  it('filters bank-account transactions in ZQL and preloads their ledger interpretation relationships', () => {
    const ast = astFor(queries.domain.bankTransactionsForBankAccount.fn({ctx: zeroContextFor('user-1'), args: {bankAccountId: 'bank-account-1'}}))

    expect(ast.table).toBe('bankTransactions')
    expect(conditionIncludesSimple(ast.where, 'bankAccountId', 'bank-account-1')).toBe(true)
    expect(conditionHasExistsPath(ast.where, ['bankAccount', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const bankAccount = relatedSubquery(ast, 'bankAccount')
    expect(bankAccount).toBeDefined()
    expect(conditionHasExistsPath(bankAccount?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const posting = relatedSubquery(ast, 'posting')
    expect(posting).toBeDefined()
    expect(conditionHasExistsPath(posting?.where, ['ledgerTransaction', 'team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const ledgerTransaction = relatedSubquery(posting, 'ledgerTransaction')
    expect(ledgerTransaction).toBeDefined()
    expect(conditionHasExistsPath(ledgerTransaction?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)

    const postings = relatedSubquery(ledgerTransaction, 'postings')
    expect(postings).toBeDefined()
    const account = relatedSubquery(postings, 'account')
    expect(account).toBeDefined()
    expect(conditionHasExistsPath(account?.where, ['team', 'members'], {field: 'userId', value: 'user-1'})).toBe(true)
  })
})

function relatedSubquery(ast: AST | undefined, alias: string): AST | undefined {
  return ast?.related?.find(related => related.subquery.alias === alias)?.subquery
}

function conditionIncludesSimple(condition: Condition | undefined, field: string, value: string | number | boolean | null): boolean {
  if (!condition) return false
  if (condition.type === 'simple') {
    return condition.left.type === 'column' && condition.left.name === field && condition.right.type === 'literal' && condition.right.value === value
  }
  if (condition.type === 'and' || condition.type === 'or') {
    return condition.conditions.some(child => conditionIncludesSimple(child, field, value))
  }
  return conditionIncludesSimple(condition.related.subquery.where, field, value)
}

function conditionHasExistsPath(
  condition: Condition | undefined,
  aliases: string[],
  expectedLeaf: {field: string; value: string | number | boolean | null},
): boolean {
  if (!condition) return false
  if (condition.type === 'and' || condition.type === 'or') {
    return condition.conditions.some(child => conditionHasExistsPath(child, aliases, expectedLeaf))
  }
  if (condition.type !== 'correlatedSubquery') return false

  const [alias, ...rest] = aliases
  if (relationshipName(condition.related.subquery.alias) !== alias) return false
  if (rest.length === 0) return conditionIncludesSimple(condition.related.subquery.where, expectedLeaf.field, expectedLeaf.value)
  return conditionHasExistsPath(condition.related.subquery.where, rest, expectedLeaf)
}

function relationshipName(alias: string | undefined) {
  return alias?.startsWith('zsubq_') ? alias.slice('zsubq_'.length) : alias
}
