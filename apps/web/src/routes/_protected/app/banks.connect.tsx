import {createFileRoute} from '@tanstack/react-router'
import {ConnectBankPage} from '@/components/banking/connect-bank-page'

export const Route = createFileRoute('/_protected/app/banks/connect')({
  component: ConnectBankPage,
})
