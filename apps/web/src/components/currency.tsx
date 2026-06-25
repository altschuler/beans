import {formatMoneyAmount} from '@penge/domain/money'

type CurrencyProps = {
  amount: number
  currency: string
  className?: string
}

export function Currency({amount, currency, className}: CurrencyProps) {
  return <span className={className}>{formatMoneyAmount(amount, currency)}</span>
}
