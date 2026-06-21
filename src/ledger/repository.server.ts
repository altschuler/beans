import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import type {Database} from '@/db/client'
import {ledgerAccountGroups, ledgerAccounts} from '@/db/schema'
import {buildDefaultLedgerChartForTeam, SYSTEM_LEDGER_ACCOUNT_KEYS} from './default-chart'

type DrizzleExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>

export async function seedDefaultLedgerChartForTeam(tx: DrizzleExecutor, teamId: string) {
  const now = new Date()
  const chart = buildDefaultLedgerChartForTeam(teamId, now)

  await tx.insert(ledgerAccountGroups).values(chart.groups).onConflictDoNothing({
    target: [ledgerAccountGroups.teamId, ledgerAccountGroups.name],
  })

  const persistedGroups = await tx
    .select({id: ledgerAccountGroups.id, name: ledgerAccountGroups.name})
    .from(ledgerAccountGroups)
    .where(eq(ledgerAccountGroups.teamId, teamId))

  const generatedGroupNamesById = new Map(chart.groups.map(group => [group.id, group.name]))
  const persistedGroupIdsByName = new Map(persistedGroups.map(group => [group.name, group.id]))
  const accounts = chart.accounts.map(account => {
    const generatedGroupName = generatedGroupNamesById.get(account.groupId)
    const persistedGroupId = generatedGroupName ? persistedGroupIdsByName.get(generatedGroupName) : undefined
    if (!persistedGroupId) throw new Error(`Missing persisted ledger group for ${generatedGroupName ?? account.groupId}`)
    return {...account, groupId: persistedGroupId}
  })

  await tx.insert(ledgerAccounts).values(accounts).onConflictDoNothing({
    target: [ledgerAccounts.teamId, ledgerAccounts.name],
  })
}

export async function requireSystemLedgerAccountId(tx: DrizzleExecutor, teamId: string, systemKey: string) {
  const [account] = await tx
    .select({id: ledgerAccounts.id})
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.teamId, teamId), eq(ledgerAccounts.systemKey, systemKey)))
    .limit(1)

  if (!account) {
    throw new Error(`Missing required ledger account ${systemKey}`)
  }

  return account.id
}

export async function ensureLedgerAccountForBankAccount(
  tx: DrizzleExecutor,
  input: {teamId: string; bankAccountId: string; name: string; now?: Date},
) {
  const [existing] = await tx
    .select({id: ledgerAccounts.id})
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.linkedBankAccountId, input.bankAccountId))
    .limit(1)

  if (existing) {
    const name = await uniqueLedgerAccountNameForBankAccount(tx, input, existing.id)
    await tx.update(ledgerAccounts).set({name, updatedAt: input.now ?? new Date()}).where(eq(ledgerAccounts.id, existing.id))
    return existing.id
  }

  const bankGroup = await findBankAccountsGroup(tx, input.teamId)
  const resolvedBankGroup = bankGroup ?? (await seedDefaultLedgerChartAndFindBankGroup(tx, input.teamId))

  const now = input.now ?? new Date()
  const id = crypto.randomUUID()
  const name = await uniqueLedgerAccountNameForBankAccount(tx, input)
  await tx.insert(ledgerAccounts).values({
    id,
    teamId: input.teamId,
    groupId: resolvedBankGroup.id,
    linkedBankAccountId: input.bankAccountId,
    systemKey: null,
    type: 'bank',
    normalBalance: 'debit',
    name,
    description: 'Imported bank account. Balance is derived from opening balance and reconciled bank transactions.',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  })

  return id
}

async function findBankAccountsGroup(tx: DrizzleExecutor, teamId: string) {
  const [bankGroup] = await tx
    .select({id: ledgerAccountGroups.id})
    .from(ledgerAccountGroups)
    .where(and(eq(ledgerAccountGroups.teamId, teamId), eq(ledgerAccountGroups.name, 'Bank accounts')))
    .limit(1)

  return bankGroup ?? null
}

async function seedDefaultLedgerChartAndFindBankGroup(tx: DrizzleExecutor, teamId: string) {
  await seedDefaultLedgerChartForTeam(tx, teamId)
  const bankGroup = await findBankAccountsGroup(tx, teamId)

  if (!bankGroup) {
    throw new Error('Missing Bank accounts ledger group')
  }

  return bankGroup
}

async function uniqueLedgerAccountNameForBankAccount(
  tx: DrizzleExecutor,
  input: {teamId: string; bankAccountId: string; name: string},
  existingLedgerAccountId?: string,
) {
  const suffix = input.bankAccountId.slice(0, 8) || input.bankAccountId
  let candidate = input.name

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [conflict] = await tx
      .select({id: ledgerAccounts.id})
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.teamId, input.teamId), eq(ledgerAccounts.name, candidate)))
      .limit(1)

    if (!conflict || conflict.id === existingLedgerAccountId) {
      return candidate
    }

    candidate = `${input.name} (${attempt === 0 ? suffix : `${suffix}-${attempt + 1}`})`
  }

  throw new Error('Could not choose a unique ledger account name')
}

export {SYSTEM_LEDGER_ACCOUNT_KEYS}
