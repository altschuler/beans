import {relations, sql} from 'drizzle-orm'
import {bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull(),
    image: text('image'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    emailIdx: uniqueIndex('user_email_unique').on(table.email),
  }),
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    token: text('token').notNull(),
    expiresAt: timestamp('expiresAt', {mode: 'date'}).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    tokenIdx: uniqueIndex('session_token_unique').on(table.token),
    userIdIdx: index('session_user_id_idx').on(table.userId),
  }),
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', {mode: 'date'}),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {mode: 'date'}),
    scope: text('scope'),
    idToken: text('idToken'),
    password: text('password'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
  }),
)

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    personalOwnerUserId: text('personal_owner_user_id').references(() => user.id, {onDelete: 'cascade'}),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    personalOwnerIdx: uniqueIndex('teams_personal_owner_unique').on(table.personalOwnerUserId),
  }),
)

export const teamMembers = pgTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamUserIdx: uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
    userIdx: index('team_members_user_idx').on(table.userId),
  }),
)

export const agentWorkflowRuns = pgTable(
  'agent_workflow_runs',
  {
    id: text('id').primaryKey(),
    flueRunId: text('flue_run_id'),
    workflowName: text('workflow_name').notNull(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'restrict'}),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
    finishedAt: timestamp('finished_at', {mode: 'date'}),
  },
  table => ({
    teamIdx: index('agent_workflow_runs_team_idx').on(table.teamId),
    activeIdx: uniqueIndex('agent_workflow_runs_active_unique')
      .on(table.teamId, table.workflowName)
      .where(sql`${table.status} = 'active'`),
    statusCheck: check('agent_workflow_runs_status_check', sql`${table.status} in ('active', 'completed', 'failed')`),
  }),
)

export const bankConnections = pgTable(
  'bank_connections',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    provider: text('provider').notNull(),
    providerInstitutionId: text('provider_institution_id').notNull(),
    providerRequisitionId: text('provider_requisition_id').notNull(),
    reference: text('reference').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamIdx: index('bank_connections_team_idx').on(table.teamId),
    referenceIdx: uniqueIndex('bank_connections_reference_unique').on(table.provider, table.reference),
    requisitionIdx: uniqueIndex('bank_connections_requisition_unique').on(
      table.provider,
      table.providerRequisitionId,
    ),
  }),
)

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    bankConnectionId: text('bank_connection_id').references(() => bankConnections.id, {onDelete: 'set null'}),
    provider: text('provider').notNull(),
    providerInstitutionId: text('provider_institution_id').notNull(),
    providerRequisitionId: text('provider_requisition_id').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    name: text('name').notNull(),
    iban: text('iban'),
    currency: text('currency'),
    status: text('status').notNull(),
    syncStatus: text('sync_status').notNull().default('idle'),
    syncError: text('sync_error'),
    syncStartedAt: timestamp('sync_started_at', {mode: 'date'}),
    lastSyncedAt: timestamp('last_synced_at', {mode: 'date'}),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamIdx: index('bank_accounts_team_idx').on(table.teamId),
    providerAccountIdx: uniqueIndex('bank_accounts_provider_team_account_unique').on(
      table.provider,
      table.teamId,
      table.providerAccountId,
    ),
    requisitionIdx: index('bank_accounts_requisition_idx').on(table.provider, table.providerRequisitionId),
  }),
)

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: text('id').primaryKey(),
    bankAccountId: text('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, {onDelete: 'cascade'}),
    providerTransactionId: text('provider_transaction_id').notNull(),
    status: text('status').notNull(),
    bookingDate: text('booking_date'),
    valueDate: text('value_date'),
    amount: bigint('amount', {mode: 'number'}).notNull(),
    currency: text('currency').notNull(),
    description: text('description').notNull(),
    counterpartyName: text('counterparty_name'),
    raw: jsonb('raw').notNull(),
    aiConfidence: integer('ai_confidence'),
    aiProcessingStartedAt: timestamp('ai_processing_started_at', {mode: 'date'}),
    aiReasoning: text('ai_reasoning'),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    accountIdx: index('bank_transactions_account_idx').on(table.bankAccountId),
    accountDateIdx: index('bank_transactions_account_booking_date_idx').on(table.bankAccountId, table.bookingDate),
    providerTransactionIdx: uniqueIndex('bank_transactions_provider_unique').on(
      table.bankAccountId,
      table.providerTransactionId,
    ),
    amountSafeIntegerCheck: check('bank_transactions_amount_safe_integer', sql`"amount" between -9007199254740991 and 9007199254740991`),
  }),
)

export const ledgerAccountGroups = pgTable(
  'ledger_account_groups',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    systemKey: text('system_key'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamIdx: index('ledger_account_groups_team_idx').on(table.teamId),
    teamNameIdx: uniqueIndex('ledger_account_groups_team_name_unique').on(table.teamId, table.name),
  }),
)

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    groupId: text('group_id')
      .notNull()
      .references(() => ledgerAccountGroups.id, {onDelete: 'restrict'}),
    linkedBankAccountId: text('linked_bank_account_id').references(() => bankAccounts.id, {onDelete: 'set null'}),
    systemKey: text('system_key'),
    type: text('type').notNull(),
    normalBalance: text('normal_balance').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamIdx: index('ledger_accounts_team_idx').on(table.teamId),
    groupIdx: index('ledger_accounts_group_idx').on(table.groupId),
    linkedBankAccountIdx: uniqueIndex('ledger_accounts_linked_bank_account_unique').on(table.linkedBankAccountId),
    teamNameIdx: uniqueIndex('ledger_accounts_team_name_unique').on(table.teamId, table.name),
    teamSystemKeyIdx: uniqueIndex('ledger_accounts_team_system_key_unique').on(table.teamId, table.systemKey),
  }),
)

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, {onDelete: 'cascade'}),
    source: text('source').notNull(),
    status: text('status').notNull(),
    categorizedBy: text('categorized_by'),
    userConfirmedAt: timestamp('user_confirmed_at', {mode: 'date'}),
    userConfirmedBy: text('user_confirmed_by'),
    date: text('date'),
    // Nullable and currently left null for bank-import interpretations: the bank transaction's
    // description is the source of truth and the UI reads it from there. Kept for future non-bank
    // ledger entries (e.g. manual transactions) that will own a real description.
    description: text('description'),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    teamIdx: index('ledger_transactions_team_idx').on(table.teamId),
    statusIdx: index('ledger_transactions_status_idx').on(table.teamId, table.status),
    dateIdx: index('ledger_transactions_date_idx').on(table.teamId, table.date),
  }),
)

export const ledgerPostings = pgTable(
  'ledger_postings',
  {
    id: text('id').primaryKey(),
    ledgerTransactionId: text('ledger_transaction_id').notNull(),
    accountId: text('account_id').notNull(),
    amount: bigint('amount', {mode: 'number'}).notNull(),
    currency: text('currency').notNull(),
    bankTransactionId: text('bank_transaction_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updated_at', {mode: 'date'}).notNull(),
  },
  table => ({
    transactionIdx: index('ledger_postings_transaction_idx').on(table.ledgerTransactionId),
    accountIdx: index('ledger_postings_account_idx').on(table.accountId),
    bankTransactionIdx: uniqueIndex('ledger_postings_bank_transaction_unique').on(table.bankTransactionId),
    transactionFk: foreignKey({
      name: 'ledger_postings_transaction_fk',
      columns: [table.ledgerTransactionId],
      foreignColumns: [ledgerTransactions.id],
    }).onDelete('cascade'),
    accountFk: foreignKey({
      name: 'ledger_postings_account_fk',
      columns: [table.accountId],
      foreignColumns: [ledgerAccounts.id],
    }).onDelete('restrict'),
    bankTransactionFk: foreignKey({
      name: 'ledger_postings_bank_transaction_fk',
      columns: [table.bankTransactionId],
      foreignColumns: [bankTransactions.id],
    }).onDelete('restrict'),
    amountSafeIntegerCheck: check('ledger_postings_amount_safe_integer', sql`"amount" between -9007199254740991 and 9007199254740991`),
  }),
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', {mode: 'date'}).notNull(),
  createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
  updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
})

export const userRelations = relations(user, ({many}) => ({
  sessions: many(session),
  accounts: many(account),
  personalTeams: many(teams),
  teamMemberships: many(teamMembers),
  requestedWorkflowRuns: many(agentWorkflowRuns),
}))

export const sessionRelations = relations(session, ({one}) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({one}) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const teamsRelations = relations(teams, ({one, many}) => ({
  personalOwner: one(user, {
    fields: [teams.personalOwnerUserId],
    references: [user.id],
  }),
  members: many(teamMembers),
  agentWorkflowRuns: many(agentWorkflowRuns),
  bankConnections: many(bankConnections),
  bankAccounts: many(bankAccounts),
  ledgerAccountGroups: many(ledgerAccountGroups),
  ledgerAccounts: many(ledgerAccounts),
  ledgerTransactions: many(ledgerTransactions),
}))

export const teamMembersRelations = relations(teamMembers, ({one}) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(user, {
    fields: [teamMembers.userId],
    references: [user.id],
  }),
}))

export const agentWorkflowRunsRelations = relations(agentWorkflowRuns, ({one}) => ({
  team: one(teams, {
    fields: [agentWorkflowRuns.teamId],
    references: [teams.id],
  }),
  requestedByUser: one(user, {
    fields: [agentWorkflowRuns.requestedByUserId],
    references: [user.id],
  }),
}))

export const bankConnectionsRelations = relations(bankConnections, ({one, many}) => ({
  team: one(teams, {
    fields: [bankConnections.teamId],
    references: [teams.id],
  }),
  bankAccounts: many(bankAccounts),
}))

export const bankAccountsRelations = relations(bankAccounts, ({one, many}) => ({
  team: one(teams, {
    fields: [bankAccounts.teamId],
    references: [teams.id],
  }),
  connection: one(bankConnections, {
    fields: [bankAccounts.bankConnectionId],
    references: [bankConnections.id],
  }),
  transactions: many(bankTransactions),
  ledgerAccount: one(ledgerAccounts, {
    fields: [bankAccounts.id],
    references: [ledgerAccounts.linkedBankAccountId],
  }),
}))

export const bankTransactionsRelations = relations(bankTransactions, ({one}) => ({
  bankAccount: one(bankAccounts, {
    fields: [bankTransactions.bankAccountId],
    references: [bankAccounts.id],
  }),
  posting: one(ledgerPostings, {
    fields: [bankTransactions.id],
    references: [ledgerPostings.bankTransactionId],
  }),
}))

export const ledgerAccountGroupsRelations = relations(ledgerAccountGroups, ({one, many}) => ({
  team: one(teams, {
    fields: [ledgerAccountGroups.teamId],
    references: [teams.id],
  }),
  accounts: many(ledgerAccounts),
}))

export const ledgerAccountsRelations = relations(ledgerAccounts, ({one, many}) => ({
  team: one(teams, {
    fields: [ledgerAccounts.teamId],
    references: [teams.id],
  }),
  group: one(ledgerAccountGroups, {
    fields: [ledgerAccounts.groupId],
    references: [ledgerAccountGroups.id],
  }),
  linkedBankAccount: one(bankAccounts, {
    fields: [ledgerAccounts.linkedBankAccountId],
    references: [bankAccounts.id],
  }),
  postings: many(ledgerPostings),
}))

export const ledgerTransactionsRelations = relations(ledgerTransactions, ({one, many}) => ({
  team: one(teams, {
    fields: [ledgerTransactions.teamId],
    references: [teams.id],
  }),
  postings: many(ledgerPostings),
}))

export const ledgerPostingsRelations = relations(ledgerPostings, ({one}) => ({
  ledgerTransaction: one(ledgerTransactions, {
    fields: [ledgerPostings.ledgerTransactionId],
    references: [ledgerTransactions.id],
  }),
  account: one(ledgerAccounts, {
    fields: [ledgerPostings.accountId],
    references: [ledgerAccounts.id],
  }),
  bankTransaction: one(bankTransactions, {
    fields: [ledgerPostings.bankTransactionId],
    references: [bankTransactions.id],
  }),
}))
