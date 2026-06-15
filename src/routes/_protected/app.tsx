import {createFileRoute} from '@tanstack/react-router'
import {ItemsPanel} from '@/components/items/items-panel'

export const Route = createFileRoute('/_protected/app')({
  component: AppPage,
})

function AppPage() {
  return <ItemsPanel />
}
