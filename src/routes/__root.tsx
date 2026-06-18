import type {ReactNode} from 'react'
import {createRootRoute, HeadContent, Outlet, Scripts} from '@tanstack/react-router'
import {Toaster} from '@/components/ui/sonner'
import appStyles from '@/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: 'Penge'},
      {name: 'description', content: 'Local-first budgeting app boilerplate'},
    ],
    links: [{rel: 'stylesheet', href: appStyles}],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({children}: Readonly<{children: ReactNode}>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
