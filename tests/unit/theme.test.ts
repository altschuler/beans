import {describe, expect, it} from 'vitest'
import {applyThemeClass, getAppliedTheme, isThemePreference, THEME_STORAGE_KEY, type ThemePreference} from '@/components/theme/theme'

describe('theme provider helpers', () => {
  it('defaults to the system preference key used for persisted theme choices', () => {
    expect(THEME_STORAGE_KEY).toBe('penge-theme')
  })

  it('maps system preference to the current system color scheme', () => {
    expect(getAppliedTheme('system', true)).toBe('dark')
    expect(getAppliedTheme('system', false)).toBe('light')
  })

  it('keeps explicit light and dark choices independent from the system color scheme', () => {
    expect(getAppliedTheme('light', true)).toBe('light')
    expect(getAppliedTheme('dark', false)).toBe('dark')
  })

  it('only accepts supported theme preferences', () => {
    const supported: ThemePreference[] = ['light', 'dark', 'system']

    for (const preference of supported) expect(isThemePreference(preference)).toBe(true)
    expect(isThemePreference('midnight')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })

  it('replaces existing theme classes with the applied theme', () => {
    const classList = new Set<string>(['dark', 'custom'])
    const root = {
      classList: {
        add: (...classNames: string[]) => classNames.forEach((className) => classList.add(className)),
        remove: (...classNames: string[]) => classNames.forEach((className) => classList.delete(className)),
        toggle: (className: string, force?: boolean) => {
          if (force) classList.add(className)
          else classList.delete(className)
          return classList.has(className)
        },
      },
    } as Element

    applyThemeClass(root, 'light')

    expect([...classList].sort()).toEqual(['custom', 'light'])
  })
})
