#!/usr/bin/env node
/* global console, crypto, process */
import 'dotenv/config'

import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import postgres from 'postgres'

export const DEFAULT_SNAPSHOT_PATH = '.local/gocardless-connections.json'
const SNAPSHOT_VERSION = 1

export function parseArgs(argv) {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h') {
    return {command: 'help'}
  }

  if (command !== 'export' && command !== 'import') {
    throw new Error(`Unknown command: ${command}`)
  }

  const options = {command, file: DEFAULT_SNAPSHOT_PATH}

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    const next = rest[index + 1]

    if (arg === '--file') {
      if (!next) throw new Error('--file requires a path')
      options.file = next
      index += 1
      continue
    }

    if (arg === '--email') {
      if (!next) throw new Error('--email requires an email address')
      options.email = next
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (command === 'import' && !options.email) {
    throw new Error('--email is required for import')
  }

  return options
}

export async function exportSnapshot(sql) {
  const connections = await sql`
    select
      id,
      provider_institution_id,
      provider_requisition_id,
      reference,
      status
    from bank_connections
    where provider = 'gocardless'
    order by created_at, id
  `

  const accounts = await sql`
    select
      bank_connection_id,
      provider_institution_id,
      provider_requisition_id,
      provider_account_id,
      name,
      iban,
      currency,
      status
    from bank_accounts
    where provider = 'gocardless'
    order by created_at, id
  `

  const accountsByConnectionId = new Map()
  for (const account of accounts) {
    const connectionAccounts = accountsByConnectionId.get(account.bank_connection_id) ?? []
    connectionAccounts.push({
      providerInstitutionId: account.provider_institution_id,
      providerRequisitionId: account.provider_requisition_id,
      providerAccountId: account.provider_account_id,
      name: account.name,
      iban: account.iban,
      currency: account.currency,
      status: account.status,
    })
    accountsByConnectionId.set(account.bank_connection_id, connectionAccounts)
  }

  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    connections: connections.map(connection => ({
      providerInstitutionId: connection.provider_institution_id,
      providerRequisitionId: connection.provider_requisition_id,
      reference: connection.reference,
      status: connection.status,
      accounts: accountsByConnectionId.get(connection.id) ?? [],
    })),
  }
}

export async function importSnapshot(sql, {email, snapshot}) {
  validateSnapshot(snapshot)

  const [team] = await sql`
    select team_members.team_id
    from "user"
    inner join team_members on team_members.user_id = "user".id
    inner join teams on teams.id = team_members.team_id
    where "user".email = ${email}
      and teams.personal_owner_user_id = "user".id
    limit 1
  `

  if (!team) {
    throw new Error(`No personal team found for ${email}`)
  }

  let accountCount = 0
  const now = new Date()

  for (const connection of snapshot.connections) {
    const [restoredConnection] = await sql`
      insert into bank_connections (
        id,
        team_id,
        provider,
        provider_institution_id,
        provider_requisition_id,
        reference,
        status,
        created_at,
        updated_at
      ) values (
        ${crypto.randomUUID()},
        ${team.team_id},
        'gocardless',
        ${connection.providerInstitutionId},
        ${connection.providerRequisitionId},
        ${connection.reference},
        ${connection.status},
        ${now},
        ${now}
      )
      on conflict (provider, provider_requisition_id) do update set
        team_id = excluded.team_id,
        provider_institution_id = excluded.provider_institution_id,
        reference = excluded.reference,
        status = excluded.status,
        updated_at = excluded.updated_at
      returning id
    `

    for (const account of connection.accounts) {
      await sql`
        insert into bank_accounts (
          id,
          team_id,
          bank_connection_id,
          provider,
          provider_institution_id,
          provider_requisition_id,
          provider_account_id,
          name,
          iban,
          currency,
          status,
          sync_status,
          created_at,
          updated_at
        ) values (
          ${crypto.randomUUID()},
          ${team.team_id},
          ${restoredConnection.id},
          'gocardless',
          ${account.providerInstitutionId},
          ${account.providerRequisitionId},
          ${account.providerAccountId},
          ${account.name},
          ${account.iban},
          ${account.currency},
          ${account.status},
          'idle',
          ${now},
          ${now}
        )
        on conflict (provider, team_id, provider_account_id) do update set
          bank_connection_id = excluded.bank_connection_id,
          provider_institution_id = excluded.provider_institution_id,
          provider_requisition_id = excluded.provider_requisition_id,
          name = excluded.name,
          iban = excluded.iban,
          currency = excluded.currency,
          status = excluded.status,
          sync_status = 'idle',
          sync_error = null,
          sync_started_at = null,
          updated_at = excluded.updated_at
        returning id
      `
      accountCount += 1
    }
  }

  return {connections: snapshot.connections.length, accounts: accountCount, teamId: team.team_id}
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.connections)) {
    throw new Error('Invalid GoCardless snapshot')
  }
}

async function writeSnapshot(file, snapshot) {
  await mkdir(path.dirname(file), {recursive: true})
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

async function readSnapshot(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

function createSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  return postgres(process.env.DATABASE_URL)
}

function printHelp() {
  console.log(`Usage:
  node scripts/gocardless-connections.mjs export [--file ${DEFAULT_SNAPSHOT_PATH}]
  node scripts/gocardless-connections.mjs import --email dev@example.com [--file ${DEFAULT_SNAPSHOT_PATH}]

Exports and restores local-dev GoCardless connection/account metadata across db resets.
The default snapshot path is ${DEFAULT_SNAPSHOT_PATH}, which should remain gitignored.`)
}

async function main(argv) {
  const args = parseArgs(argv)

  if (args.command === 'help') {
    printHelp()
    return
  }

  const sql = createSql()
  try {
    if (args.command === 'export') {
      const snapshot = await exportSnapshot(sql)
      await writeSnapshot(args.file, snapshot)
      console.log(`Exported ${snapshot.connections.length} GoCardless connection(s) to ${args.file}`)
      return
    }

    const snapshot = await readSnapshot(args.file)
    const result = await importSnapshot(sql, {email: args.email, snapshot})
    console.log(
      `Imported ${result.connections} GoCardless connection(s) and ${result.accounts} account(s) to team ${result.teamId}`,
    )
  } finally {
    await sql.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
