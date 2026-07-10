import {useSyncExternalStore} from 'react'

const desktopChatQuery = '(min-width: 1024px)'

function subscribe(callback: () => void) {
  const media = window.matchMedia(desktopChatQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

export function useChatDesktopLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(desktopChatQuery).matches, () => false)
}
