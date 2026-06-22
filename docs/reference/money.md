# Money representation and display

## Canonical money shape

Penge represents money values as:

```ts
type Money = {
  amount: number
  currency: string
}
```

`amount` is a signed integer scaled by `10_000`. `currency` is an uppercase currency code such as `DKK`, `EUR`, or `USD`.

Examples:

| Display value | Canonical amount | Currency |
| --- | ---: | --- |
| `100.00 DKK` | `1_000_000` | `DKK` |
| `-42.50 DKK` | `-425_000` | `DKK` |
| `0.0001 DKK` | `1` | `DKK` |

All persisted and synced money amounts must be safe integers. Do not use JavaScript decimal fractions for money arithmetic, and do not treat synced `amount` fields as decimal major-unit values.

## Storage and sync

`bank_transactions.amount` and `ledger_postings.amount` are stored as Postgres `bigint` values. Drizzle and Zero expose them as `number`, with database checks keeping values inside JavaScript's safe-integer range.

The invariant is global: money `amount` fields in storage, Zero data, model inputs, and display component props are scale-4 integers unless a form boundary explicitly says it accepts a user-entered decimal string.

## Import and form boundaries

Provider amounts arrive as decimal strings. The import boundary parses them into scale-4 integers and rounds to the nearest scale-4 unit, with half values rounded away from zero.

Split/category form lines may also hold temporary decimal strings while the user edits. Server-side categorization parses those strings into canonical integers before building ledger postings.

Invalid decimal syntax or unsafe scaled values are rejected at the boundary rather than being stored.

## Arithmetic and signs

Money arithmetic uses integer addition, comparison, absolute values, and signs. Ledger posting signs remain the canonical accounting direction; account display rules decide whether a derived balance is shown directly or credit-normalized for category/envelope accounts.

## Display

Visible money should use the shared `Currency` component:

```tsx
<Currency amount={row.amount} currency={row.currency} />
```

The component accepts canonical scale-4 integer amounts and renders a conservative decimal value followed by the currency code, for example `-100.00 DKK`. It uses the currency's normal number of minor-unit decimals when that is enough, but keeps up to four decimals when sub-minor precision exists.

Financial tables should keep amount cells right-aligned and monospaced with caller-owned layout classes.
