export type GoCardlessInstitution = {
  id: string
  name: string
  bic?: string
  transaction_total_days?: string
  countries: string[]
  logo?: string
  supported_features?: string[]
}

export type GoCardlessRequisition = {
  id: string
  created: string
  redirect: string
  status: string
  institution_id: string
  reference: string
  accounts: string[]
  link: string
}

export type GoCardlessAccountDetails = {
  account?: {
    iban?: string
    currency?: string
    name?: string
    displayName?: string
    product?: string
    ownerName?: string
  }
}

export type GoCardlessTransactionAmount = {
  amount: string
  currency: string
}

export type GoCardlessTransaction = {
  transactionId?: string
  bookingDate?: string
  valueDate?: string
  transactionAmount: GoCardlessTransactionAmount
  remittanceInformationUnstructured?: string
  remittanceInformationUnstructuredArray?: string[]
  creditorName?: string
  debtorName?: string
  additionalInformation?: string
}

export type GoCardlessTransactionsResponse = {
  transactions: {
    booked?: GoCardlessTransaction[]
    pending?: GoCardlessTransaction[]
  }
}
