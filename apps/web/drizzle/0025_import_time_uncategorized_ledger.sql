CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

WITH candidates AS (
  SELECT
    bt.id AS bank_transaction_id,
    gen_random_uuid()::text AS ledger_transaction_id,
    gen_random_uuid()::text AS bank_posting_id,
    gen_random_uuid()::text AS uncategorized_posting_id,
    ba.team_id,
    bt.amount,
    bt.currency,
    COALESCE(bt.booking_date, bt.value_date) AS transaction_date,
    bank_ledger_accounts.id AS bank_ledger_account_id,
    uncategorized_accounts.id AS uncategorized_account_id
  FROM bank_transactions bt
  INNER JOIN bank_accounts ba ON ba.id = bt.bank_account_id
  INNER JOIN ledger_accounts bank_ledger_accounts
    ON bank_ledger_accounts.linked_bank_account_id = bt.bank_account_id
    AND bank_ledger_accounts.team_id = ba.team_id
  INNER JOIN ledger_accounts uncategorized_accounts
    ON uncategorized_accounts.team_id = ba.team_id
    AND uncategorized_accounts.system_key = 'uncategorized'
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger_postings existing
    WHERE existing.bank_transaction_id = bt.id
  )
), inserted_transactions AS (
  INSERT INTO ledger_transactions (
    id,
    team_id,
    source,
    status,
    categorized_by,
    user_confirmed_at,
    user_confirmed_by,
    date,
    description,
    created_at,
    updated_at
  )
  SELECT
    ledger_transaction_id,
    team_id,
    'bank_import',
    'needs_review',
    NULL,
    NULL,
    NULL,
    transaction_date,
    NULL,
    now(),
    now()
  FROM candidates
  RETURNING id
), inserted_bank_postings AS (
  INSERT INTO ledger_postings (
    id,
    ledger_transaction_id,
    account_id,
    amount,
    currency,
    bank_transaction_id,
    sort_order,
    created_at,
    updated_at
  )
  SELECT
    candidates.bank_posting_id,
    candidates.ledger_transaction_id,
    candidates.bank_ledger_account_id,
    candidates.amount,
    candidates.currency,
    candidates.bank_transaction_id,
    0,
    now(),
    now()
  FROM candidates
  INNER JOIN inserted_transactions ON inserted_transactions.id = candidates.ledger_transaction_id
  RETURNING ledger_transaction_id
)
INSERT INTO ledger_postings (
  id,
  ledger_transaction_id,
  account_id,
  amount,
  currency,
  bank_transaction_id,
  sort_order,
  created_at,
  updated_at
)
SELECT
  candidates.uncategorized_posting_id,
  candidates.ledger_transaction_id,
  candidates.uncategorized_account_id,
  -candidates.amount,
  candidates.currency,
  NULL,
  1,
  now(),
  now()
FROM candidates
INNER JOIN inserted_transactions ON inserted_transactions.id = candidates.ledger_transaction_id
INNER JOIN inserted_bank_postings ON inserted_bank_postings.ledger_transaction_id = candidates.ledger_transaction_id;
