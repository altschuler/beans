# Canonical money format and Currency component design

## Context

Penge currently stores monetary values in Postgres as `numeric(18,4)` for `bank_transactions.amount` and `ledger_postings.amount`. Most application code treats those values as decimal strings and uses scale-4 helpers such as `parseMoneyToScaledUnits` and `formatScaledUnits` for exact arithmetic.

The related TODO entry notes a precision problem: Zero maps those numeric columns to `number`, so values can pass through IEEE-754 floating point before client code turns them back into strings. This risks subtle precision loss and inconsistent formatting.

This design settles a canonical money representation and introduces a shared `Currency` display component that should be used anywhere money is shown.

## Goals

- Use one canonical money amount format across storage, sync, model code, and display component inputs.
- Avoid decimal floating-point precision bugs in Zero/client code.
- Keep arithmetic simple and exact.
- Keep the UI display of money consistent and unambiguous.
- Preserve support for scale-4 precision.

## Non-goals

- Add currency conversion or exchange-rate handling.
- Add multi-locale user preferences.
- Change accounting sign semantics.
- Redesign transaction/category UI beyond replacing money rendering.

## Considered approaches

### 1. Decimal string amount

Example: `{amount: '-100.0000', currency: 'DKK'}`.

Pros:

- Human-readable in raw data.
- Close to current application helper behavior.
- Matches `numeric(18,4)` conceptually.

Cons:

- Arithmetic requires parsing strings.
- Zero needs explicit string/custom mapping to avoid float64 transit.
- Multiple valid textual spellings must be normalized unless validation is strict.

### 2. Scaled integer string amount

Example: `{amount: '-1000000', currency: 'DKK'}` with scale 4.

Pros:

- Exact across any magnitude Postgres can store.
- Avoids JS safe-integer limits.

Cons:

- Less ergonomic in app code.
- Arithmetic still requires parsing to `bigint` or another integer representation.
- More boilerplate than needed for Penge's expected amount ranges.

### 3. Scaled integer number amount — chosen

Example: `{amount: -1000000, currency: 'DKK'}` with scale 4.

Pros:

- Exact integer arithmetic while values stay within `Number.MAX_SAFE_INTEGER`.
- Works naturally with Zero `number` without decimal fraction precision loss.
- Simple component and model APIs.
- Matches the existing scale-4 domain precision.

Cons:

- Raw database values are less human-readable.
- Requires safe-integer validation at boundaries.
- The maximum safe represented major-unit amount at scale 4 is about `900,719,925,474.0991`, which is enough for this product but should still be enforced.

## Canonical money type

Use this shape everywhere a money value is passed as data:

```ts
type Money = {
  amount: number
  currency: string
}
```

`amount` is a signed integer scaled by `10_000`.

Examples:

| Real value | Canonical amount | Currency |
| --- | ---: | --- |
| `100.0000` | `1_000_000` | `DKK` |
| `-42.5000` | `-425_000` | `DKK` |
| `0.0001` | `1` | `DKK` |

Rules:

- `amount` must satisfy `Number.isSafeInteger(amount)`.
- `currency` is an uppercase ISO 4217 code such as `DKK`, `EUR`, or `USD`.
- Scale is fixed globally at 4 decimal places.
- Do not use JS decimal fractions for money arithmetic.
- Do not pass decimal strings to UI components after migration.

## Storage and sync

Use Postgres `bigint` for scaled money amounts:

- `bank_transactions.amount`
- `ledger_postings.amount`

Drizzle and Zero should expose these columns as `number`, with validation ensuring all stored values remain within JS safe-integer limits.

Existing decimal values migrate with:

```txt
scaled = round(decimal_amount * 10_000)
```

Examples:

```txt
-100.0000 -> -1_000_000
70.2500   -> 702_500
0.0001    -> 1
```

Keep the property/column name `amount`. The invariant is documented globally: every stored/synced `amount` for money is a scale-4 integer.

## Provider import parsing

Bank/provider decimal strings are parsed at the import boundary and rounded to the nearest scale-4 unit before storage.

Examples:

```txt
42.12344 -> 421_234
42.12345 -> 421_235
-42.12345 -> -421_235
```

Parsing should reject invalid decimal syntax and non-finite values. Rounding uses nearest scale-4 unit with half values rounded away from zero, so `42.12345 -> 421_235` and `-42.12345 -> -421_235`. Rounding should be covered by tests, including negative values.

## Money helpers

Add or refactor shared helpers around the canonical format:

- Parse provider decimal strings into scaled integer amounts with 4-decimal rounding.
- Format scaled integer amounts into decimal strings for display.
- Validate safe integer amounts.
- Convert absolute values and signs using integer arithmetic.
- Aggregate and compare amounts using integer arithmetic.

Existing helpers in `src/ledger/categorization.ts` can be migrated or replaced so ledger/category logic no longer converts through decimal strings.

## Currency component

Add a shared display component:

```tsx
<Currency amount={row.amount} currency={row.currency} />
```

Props:

```ts
type CurrencyProps = {
  amount: number
  currency: string
  className?: string
}
```

Display behavior:

- Accept only canonical scaled integer numbers.
- Validate safe integer values in development/test paths.
- Render a conservative, unambiguous format: decimal amount followed by currency code, for example `-100.00 DKK`.
- Use normal currency decimals where possible: usually 2 decimals for `DKK`, `EUR`, and `USD`; 0 for `JPY`; up to 4 decimals when sub-minor-unit precision exists.
- Preserve signs exactly as canonical data indicates.
- Allow callers to control alignment/layout with `className`; financial table callers should keep amounts right-aligned and monospaced per `docs/DESIGN.md`.

The component should become the default for visible money in transaction rows, ledger posting tables, account detail rows, dashboards, and future money displays.

## Data flow

1. Provider/import boundary receives decimal string plus currency.
2. Parser rounds to scale 4 and stores a scaled integer `amount` with the currency code.
3. Postgres stores the scaled amount as `bigint`.
4. Zero syncs the amount as `number`.
5. Models use integer arithmetic for totals, signs, and comparisons.
6. UI passes canonical `amount` and `currency` to `Currency` for display.

## Error handling

- Invalid provider amount strings fail import for that transaction and surface through the existing sync error path.
- Unsafe integer values are rejected before insert/update.
- `Currency` should fail loudly in tests/development for unsafe or non-integer amounts, because that means a caller is not using the canonical format.
- Existing domain validation for zero/non-zero amounts stays domain-specific; the canonical format itself permits zero.

## Testing

Add focused coverage for:

- Decimal import parsing and scale-4 rounding, including negative and half-step values.
- Safe-integer validation.
- Migration conversion from existing decimal values to scaled integers.
- Ledger categorization arithmetic using integers.
- Balance derivation and split totals using integers.
- Zero/schema amount type remaining `number` after the bigint migration.
- `Currency` display for:
  - positive and negative values
  - normal two-decimal values
  - zero
  - sub-cent precision such as `1 -> 0.0001 DKK`
  - non-2-decimal currencies such as `JPY`

## Rollout notes

This is a cross-cutting data representation change. A safe implementation plan should keep the migration and code changes tightly coordinated:

1. Add helpers and tests around the new canonical format.
2. Migrate schema from `numeric(18,4)` to `bigint` using rounded scale-4 conversion.
3. Regenerate Zero schema.
4. Update server/import/domain code to use integer amounts.
5. Update model and UI types from `string | number`/`string` to canonical `number`.
6. Add and adopt the `Currency` component at visible money call sites.
7. Remove obsolete decimal-string formatting paths after callers are migrated.
