export function formatRelativeTime(value: string | number | Date | null | undefined) {
  if (!value) return 'never'

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'never'

  const diffMs = timestamp - Date.now()
  const divisions = [
    {amount: 31_536_000_000, unit: 'year'},
    {amount: 2_592_000_000, unit: 'month'},
    {amount: 86_400_000, unit: 'day'},
    {amount: 3_600_000, unit: 'hour'},
    {amount: 60_000, unit: 'minute'},
    {amount: 1_000, unit: 'second'},
  ] as const
  const absDiffMs = Math.abs(diffMs)
  const division = divisions.find(({amount}) => absDiffMs >= amount) ?? divisions[divisions.length - 1]
  const relativeValue = Math.round(diffMs / division.amount)

  return new Intl.RelativeTimeFormat('en', {numeric: 'auto'}).format(relativeValue, division.unit)
}
