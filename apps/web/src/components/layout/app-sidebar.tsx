import {Link, useRouter, useRouterState} from '@tanstack/react-router'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {Banknote, ChevronsUpDown, CreditCard, Home, Landmark, LogOut, Monitor, Moon, ReceiptText, ScrollText, Sun, Tags} from 'lucide-react'
import {authClient} from '@/auth/client'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {isThemePreference, useTheme} from '@/components/theme/theme'
import {queries} from '@/zero/queries'

type AppSidebarProps = {
  userEmail: string
  userName?: string | null
}

const primaryNavItems = [
  {title: 'Home', to: '/app' as const, icon: Home},
  {title: 'Transactions', to: '/app/transactions' as const, icon: ReceiptText},
  {title: 'Categories', to: '/app/categories' as const, icon: Tags},
  {title: 'Ledger', to: '/ledger' as const, icon: ScrollText},
]

export function AppSidebar({userEmail, userName}: AppSidebarProps) {
  const router = useRouter()
  const pathname = useRouterState({select: state => state.location.pathname})
  const zero = useZero()
  const [teams] = useQuery(queries.domain.teams())
  const [bankAccounts, bankAccountsStatus] = useQuery(queries.domain.bankAccounts())
  const {isMobile, setOpenMobile} = useSidebar()
  const {theme, setTheme} = useTheme()
  const teamName = teams[0]?.name ?? 'Penge'
  const displayName = userName || userEmail
  const bankAccountsComplete = bankAccountsStatus.type === 'complete'

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false)
  }

  async function signOut() {
    // Purge this user's synced data from IndexedDB so it does not linger at rest
    // on shared devices. Zero partitions storage by userID, so this is about
    // data-at-rest cleanup, not preventing cross-user reads.
    await zero.delete()
    await authClient.signOut()
    await router.navigate({to: '/login', search: {redirect: undefined}})
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/app" onClick={closeMobileSidebar}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Banknote className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{teamName}</span>
                  <span className="truncate text-xs text-muted-foreground">Penge</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNavItems.map(item => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.title}>
                    <Link to={item.to} onClick={closeMobileSidebar}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Bank accounts</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {bankAccounts.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-xs text-muted-foreground">{bankAccountsComplete ? 'No bank accounts yet' : 'Syncing bank accounts…'}</div>
                </SidebarMenuItem>
              ) : (
                bankAccounts.map(account => (
                  <SidebarMenuItem key={account.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/app/bank-accounts/${account.id}`}
                      tooltip={account.name}
                    >
                      <Link to="/app/bank-accounts/$bankAccountId" params={{bankAccountId: account.id}} onClick={closeMobileSidebar}>
                        <CreditCard />
                        <span>{account.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/app/bank-accounts'} tooltip="Manage bank accounts">
                  <Link to="/app/bank-accounts" onClick={closeMobileSidebar}>
                    <Landmark />
                    <span>Manage bank accounts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" data-testid="sidebar-user-menu" tooltip={displayName}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{displayName}</span>
                    <span data-testid="session-email" className="truncate text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="grid gap-1 text-sm leading-tight">
                    <span className="truncate font-semibold">{displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    aria-label="Theme"
                    value={theme}
                    onValueChange={(value) => {
                      if (isThemePreference(value)) setTheme(value)
                    }}
                  >
                    <DropdownMenuRadioItem value="light">
                      <Sun />
                      <span>Light</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <Moon />
                      <span>Dark</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <Monitor />
                      <span>System</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="sign-out" onSelect={() => void signOut()}>
                  <LogOut />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
