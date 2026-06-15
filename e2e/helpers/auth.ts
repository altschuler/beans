import {expect, type Page} from '@playwright/test'
import type {TestUserInput} from '../../tests/fixtures/users'

export const auth = {
  async signUp(page: Page, user: TestUserInput) {
    await page.goto('/login')
    await expect(page.getByTestId('auth-toggle')).toBeVisible()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.getByTestId('auth-toggle').click()
      if ((await page.getByTestId('auth-name').count()) > 0) {
        break
      }
      await page.waitForTimeout(500)
    }

    await page.getByTestId('auth-name').fill(user.name)
    await page.getByTestId('auth-email').fill(user.email)
    await page.getByTestId('auth-password').fill(user.password)
    await page.getByTestId('auth-submit').click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByTestId('session-email')).toHaveText(user.email)
  },
  async signOut(page: Page) {
    await page.getByTestId('sign-out').click()
    await expect(page).toHaveURL(/\/login$/)
  },
  async signIn(page: Page, user: TestUserInput) {
    await page.goto('/login')
    await expect(page.getByTestId('auth-toggle')).toBeVisible()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.getByTestId('auth-toggle').click()
      if ((await page.getByTestId('auth-name').count()) > 0) {
        await page.getByTestId('auth-toggle').click()
        break
      }
      await page.waitForTimeout(500)
    }

    await expect(page.getByTestId('auth-name')).toHaveCount(0)
    await page.getByTestId('auth-email').fill(user.email)
    await page.getByTestId('auth-password').fill(user.password)
    await page.getByTestId('auth-submit').click()
    await expect(page).toHaveURL(/\/app$/)
  },
}
