import {createFileRoute} from '@tanstack/react-router'
import {ConnectBankPage} from '@/components/banking/connect-bank-page'

export const Route = createFileRoute('/_protected/app/bank-accounts/connect')({
  component: ConnectBankPage,
})
