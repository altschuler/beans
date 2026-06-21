import * as React from 'react'

export const THEME_STORAGE_KEY = 'penge-theme'

export type ThemePreference = 'light' | 'dark' | 'system'
export type AppliedTheme = 'light' | 'dark'

export type ThemeContextValue = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  appliedTheme: AppliedTheme
}

const themePreferences = ['light', 'dark', 'system'] as const

export const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (themePreferences as readonly string[]).includes(value)
}

export function getAppliedTheme(theme: ThemePreference, systemDark: boolean): AppliedTheme {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

export function applyThemeClass(root: Element, appliedTheme: AppliedTheme) {
  root.classList.toggle('dark', appliedTheme === 'dark')
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
