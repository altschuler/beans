import {type ReactNode} from 'react'
import {TeamChatDesktopSidebar, TeamChatSidebarHost, TeamChatSidebarProvider} from '@/components/flue/team-chat-sidebar'
import {AppSidebar} from '@/components/layout/app-sidebar'
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar'

type ShellProps = {
  children: ReactNode
  userEmail: string
  userName?: string | null
  userId?: string | null
}

export function Shell({children, userEmail, userName, userId}: ShellProps) {
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <TeamChatSidebarProvider userId={userId ?? null}>
        <AppSidebar userEmail={userEmail} userName={userName} />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          <TeamChatSidebarHost>{children}</TeamChatSidebarHost>
        </SidebarInset>
        <TeamChatDesktopSidebar />
      </TeamChatSidebarProvider>
    </SidebarProvider>
  )
}
