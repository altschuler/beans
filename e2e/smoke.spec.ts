import {test} from '@playwright/test'
import {testUser} from '../tests/fixtures/users'
import {app} from './helpers/app'
import {auth} from './helpers/auth'
import {expectItemHidden, expectItemVisible} from './helpers/assertions'

test('auth and Zero-backed demo item flow works end to end', async ({page}) => {
  const user = testUser()
  const itemTitle = `Playwright item ${crypto.randomUUID()}`

  await auth.signUp(page, user)
  await app.createItem(page, itemTitle)
  await expectItemVisible(page, itemTitle)

  await app.updateFirstItem(page, `${itemTitle} updated`)
  await expectItemVisible(page, `${itemTitle} updated`)

  await app.deleteFirstItem(page)
  await expectItemHidden(page, `${itemTitle} updated`)

  await auth.signOut(page)
  await auth.signIn(page, user)
  await expectItemHidden(page, `${itemTitle} updated`)
})
