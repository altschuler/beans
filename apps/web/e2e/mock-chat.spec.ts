import {expect, test} from '@playwright/test'
import {testUser} from '../tests/fixtures/users'
import {auth} from './helpers/auth'

test('signed-in Zero app streams mock chat, resumes history, and isolates another user', async ({page, browser, baseURL}) => {
  test.skip(process.env.FLUE_MOCK !== '1', 'Requires the explicit mock-only Flue sidecar (amp orb services ensure)')
  await auth.signUp(page, testUser())
  await page.getByRole('link', {name: 'Categories', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Edit category Groceries', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Chat', exact: true}).click()
  await expect(page.getByText('Your conversation is saved here.', {exact: false})).toBeVisible()
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('First private mock check')
  await page.getByRole('button', {name: 'Send', exact: true}).click()
  await expect(page.getByRole('status')).toHaveText('Working…')
  await expect(page.getByText('Mock reply (1 user messages): local sandbox works', {exact: true})).toBeVisible()
  await page.reload()
  await page.getByRole('button', {name: 'Chat', exact: true}).click()
  await expect(page.getByText('First private mock check', {exact: true})).toBeVisible()

  const other = await browser.newContext({baseURL, ignoreHTTPSErrors: true})
  try {
    expect((await other.request.get('/api/chat/current')).status()).toBe(401)
    const otherPage = await other.newPage()
    await auth.signUp(otherPage, testUser())
    await otherPage.getByRole('button', {name: 'Chat', exact: true}).click()
    await expect(otherPage.getByText('Your conversation is saved here.', {exact: false})).toBeVisible()
    await expect(otherPage.getByText('First private mock check', {exact: true})).toHaveCount(0)
    await otherPage.getByRole('textbox', {name: 'Message', exact: true}).fill('Other user mock check')
    await page.setViewportSize({width: 390, height: 844})
    await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Continue on mobile')
    await Promise.all([
      page.getByRole('button', {name: 'Send', exact: true}).click(),
      otherPage.getByRole('button', {name: 'Send', exact: true}).click(),
    ])
    await expect(page.getByText('Mock reply (2 user messages): local sandbox works', {exact: true})).toBeVisible()
    await expect(otherPage.getByText('Mock reply (1 user messages): local sandbox works', {exact: true})).toBeVisible()
    await expect(page.getByText('Other user mock check', {exact: true})).toHaveCount(0)
    await page.getByRole('button', {name: 'Close chat', exact: true}).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await other.close()
  }
})
