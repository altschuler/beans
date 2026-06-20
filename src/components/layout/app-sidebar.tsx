import {Link, useRouter, useRouterState} from '@tanstack/react-router'
import {useQuery} from '@rocicorp/zero/react'
import {Banknote, CreditCard, Home, Landmark, LogOut, ReceiptText, Tags} from 'lucide-react'
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
import {queries} from '@/zero/queries'

type AppSidebarProps = {
  userEmail: string
  userName?: string | null
}

const primaryNavItems = [
  {title: 'Home', to: '/app' as const, icon: Home},
  {title: 'Transactions', to: '/app/transactions' as const, icon: ReceiptText},
  {title: 'Categories', to: '/app/categories' as const, icon: Tags},
]

export function AppSidebar({userEmail, userName}: AppSidebarProps) {
  const router = useRouter()
  const pathname = useRouterState({select: state => state.location.pathname})
  const [teams] = useQuery(queries.domain.teams())
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const {isMobile, setOpenMobile} = useSidebar()
  const teamName = teams[0]?.name ?? 'Penge'
  const displayName = userName || userEmail

  function closeMobileSidebar() {
    if (isMobile) setOpenMobile(false)
  }

  async function signOut() {
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
                  <div className="px-2 py-1 text-xs text-muted-foreground">No bank accounts yet</div>
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
                <SidebarMenuButton asChild isActive={pathname === '/app/banks'} tooltip="Manage bank connections">
                  <Link to="/app/banks" onClick={closeMobileSidebar}>
                    <Landmark />
                    <span>Manage bank connections</span>
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
            <div
              data-sidebar="menu-button"
              data-size="default"
              title={displayName}
              className="peer/menu-button flex w-full items-start gap-3 overflow-hidden rounded-md p-2 py-3 text-left text-sm outline-hidden transition-[width,height,padding] group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                <span data-testid="session-email" className="truncate text-xs text-muted-foreground">
                  {userEmail}
                </span>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton data-testid="sign-out" onClick={() => void signOut()} tooltip="Sign out">
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
