import {createFileRoute} from '@tanstack/react-router'
import {CategoryManagementPage} from '@/components/ledger/category-management-page'

export const Route = createFileRoute('/_protected/app/categories')({
  component: CategoryManagementPage,
})
