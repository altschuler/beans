import {expect, type Page} from '@playwright/test'

export const app = {
  async createItem(page: Page, title: string) {
    await page.getByTestId('item-title').fill(title)
    await page.getByTestId('create-item').click()
    await expect(page.getByText(title)).toBeVisible()
  },
  async updateFirstItem(page: Page, expectedUpdatedTitle: string) {
    await page.getByTestId('update-item').first().click()
    await expect(page.getByText(expectedUpdatedTitle)).toBeVisible()
  },
  async deleteFirstItem(page: Page) {
    await page.getByTestId('delete-item').first().click()
    await expect(page.getByTestId('items-empty')).toBeVisible()
  },
}
