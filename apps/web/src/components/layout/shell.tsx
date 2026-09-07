import {type ReactNode} from 'react'
import {AppSidebar} from '@/components/layout/app-sidebar'
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar'

type ShellProps = {
  children: ReactNode
  userEmail: string
  userName?: string | null
}

export function Shell({children, userEmail, userName}: ShellProps) {
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar userEmail={userEmail} userName={userName} />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">{children}</SidebarInset>
    </SidebarProvider>
  )
}
