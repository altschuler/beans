import {expect, type Page} from '@playwright/test'

export async function expectItemVisible(page: Page, title: string) {
  await expect(page.getByText(title)).toBeVisible()
}

export async function expectItemHidden(page: Page, title: string) {
  await expect(page.getByText(title)).toHaveCount(0)
}
