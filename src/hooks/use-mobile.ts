import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function getIsMobileSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function subscribeToMobileChanges(callback: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
  const onChange = () => callback()

  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileChanges,
    getIsMobileSnapshot,
    () => false
  )
}
