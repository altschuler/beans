import {expect, test} from '@playwright/test'
import {testUser} from '../tests/fixtures/users'
import {auth} from './helpers/auth'

test('authenticated app renders banking dashboard', async ({page}) => {
  const user = testUser()

  await auth.signUp(page, user)
  await expect(page.getByRole('heading', {name: 'Connect bank'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Linked accounts'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible()
  await expect(page.getByTestId('institution-filter')).toBeVisible()
  await expect(page.getByTestId('connect-bank')).toBeVisible()

  await auth.signOut(page)
  await auth.signIn(page, user)
  await expect(page.getByRole('heading', {name: 'Connect bank'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Linked accounts'})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Transactions'})).toBeVisible()
  await expect(page.getByTestId('institution-filter')).toBeVisible()
  await expect(page.getByTestId('connect-bank')).toBeVisible()
})
