import * as React from 'react'
import {applyThemeClass, getAppliedTheme, isThemePreference, ThemeContext, THEME_STORAGE_KEY, type ThemePreference, type ThemeContextValue} from '@/components/theme/theme'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: ThemePreference
  storageKey?: string
}

export function ThemeProvider({children, defaultTheme = 'system', storageKey = THEME_STORAGE_KEY}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<ThemePreference>(() => readStoredTheme(storageKey) ?? defaultTheme)
  const [systemDark, setSystemDark] = React.useState(() => readSystemDarkPreference())
  const appliedTheme = getAppliedTheme(theme, systemDark)

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function handleChange(event: MediaQueryListEvent) {
      setSystemDark(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  React.useEffect(() => {
    applyThemeClass(document.documentElement, appliedTheme)
  }, [appliedTheme])

  const setTheme = React.useCallback(
    (nextTheme: ThemePreference) => {
      setThemeState(nextTheme)
      try {
        window.localStorage.setItem(storageKey, nextTheme)
      } catch {
        // Theme changes should still work when storage is unavailable.
      }
    },
    [storageKey],
  )

  const value = React.useMemo<ThemeContextValue>(() => ({theme, setTheme, appliedTheme}), [theme, setTheme, appliedTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

function readStoredTheme(storageKey: string): ThemePreference | null {
  if (typeof window === 'undefined') return null

  try {
    const storedTheme = window.localStorage.getItem(storageKey)
    return isThemePreference(storedTheme) ? storedTheme : null
  } catch {
    return null
  }
}

function readSystemDarkPreference() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
