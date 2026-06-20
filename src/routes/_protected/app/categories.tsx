import {createFileRoute} from '@tanstack/react-router'
import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

export const Route = createFileRoute('/_protected/app/categories')({
  component: CategoriesPage,
})

function CategoriesPage() {
  return <LedgerDashboard view="categories" />
}
