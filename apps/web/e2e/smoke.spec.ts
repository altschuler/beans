import {expect, test} from '@playwright/test'
import {testUser} from '../tests/fixtures/users'
import {auth} from './helpers/auth'

test('authenticated app renders the app shell', async ({page}) => {
  const user = testUser()

  await auth.signUp(page, user)

  await expect(page.getByRole('heading', {name: 'Welcome to Penge'})).toBeVisible()
  await expect(page.getByRole('link', {name: 'Transactions'})).toBeVisible()
  await expect(page.getByRole('link', {name: 'Categories'})).toBeVisible()
})
