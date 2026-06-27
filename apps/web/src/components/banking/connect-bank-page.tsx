import {useEffect, useId, useState} from 'react'
import {listDanishInstitutions, startBankLink} from '@/banking/banking-fns'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {cn} from '@/lib/utils'

type Institution = Awaited<ReturnType<typeof listDanishInstitutions>>[number]

type ConnectBankContentProps = {
  className?: string
}

export function ConnectBankPage() {
  return (
    <PageLayout
      breadcrumbs={[{title: 'Bank accounts', to: '/app/bank-accounts'}, {title: 'Connect bank'}]}
      contentClassName="p-4 md:p-6 lg:p-8"
    >
      <ConnectBankContent className="max-w-3xl" />
    </PageLayout>
  )
}

export function ConnectBankContent({className}: ConnectBankContentProps) {
  const institutionFilterId = useId()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const institutionResult = await listDanishInstitutions()
        if (!cancelled) {
          setInstitutions(institutionResult)
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not load banking data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const query = filter.trim().toLowerCase()
  const filteredInstitutions = (query ? institutions.filter((institution) => institution.name.toLowerCase().includes(query)) : institutions).slice(0, 20)

  async function connectBank(institutionId: string) {
    try {
      const result = await startBankLink({
        data: {institutionId},
      })
      window.location.assign(result.link)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start bank connection')
    }
  }

  return (
    <section className={cn('flex min-h-0 flex-col gap-4', className)}>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="space-y-2">
        <Label htmlFor={institutionFilterId}>Find bank</Label>
        <Input
          id={institutionFilterId}
          data-testid="institution-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search Danish banks"
        />
      </div>
      <ul data-testid="institution-list" className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {filteredInstitutions.map((institution) => (
          <li key={institution.id} className="flex items-center justify-between gap-4 rounded-md border bg-background p-4">
            <div className="flex min-w-0 items-center gap-3">
              {institution.logo ? (
                <img
                  src={institution.logo}
                  alt={`${institution.name} logo`}
                  className="h-10 w-10 rounded-md border bg-muted object-contain p-1"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted text-sm font-medium text-muted-foreground"
                >
                  {institutionInitials(institution.name)}
                </span>
              )}
              <span className="min-w-0 text-base font-medium">{institution.name}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              aria-label={`Connect ${institution.name}`}
              onClick={() => connectBank(institution.id)}
              disabled={loading}
            >
              Connect
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function institutionInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(word => word[0]?.toUpperCase()).join('') || 'B'
}
