import {createFileRoute} from '@tanstack/react-router'
import {BankingDashboard} from '@/components/banking/banking-dashboard'

export const Route = createFileRoute('/_protected/app/banks')({
  component: BanksPage,
})

function BanksPage() {
  return <BankingDashboard />
}
