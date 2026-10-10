import { expect, test } from '@playwright/test'

const user = {
  id: 'u1', email: 'mentor@example.test', full_name: 'Mira Tan',
  firm_role: 'partner', is_admin: false, default_team_id: null,
  created_at: '2026-10-09T00:00:00Z',
}

async function mockSession(page: import('@playwright/test').Page, active: boolean) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token')
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', email: 'mentor@example.test', fullName: 'Mira Tan', firmRole: 'partner', isAdmin: false,
    }))
  })
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path === '/me' ? user
      : path === '/classes/status' ? (active
        ? { status: 'active', class_id: 'team-a', name: 'Autumn intake', role: 'owner' }
        : { status: 'none' })
      : path === '/classes/current/members' ? [{ id: 'u1', full_name: 'Mira Tan', role: 'owner' }]
        : path === '/classes/current/requests' ? [] : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('signed-in user joins a team from the onboarding screen at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSession(page, false)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your team awaits' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join a team' })).toBeVisible()
  await expect(page.getByLabel('Six-digit team code')).toBeVisible()
  await expect(page.getByText('Join a class')).toHaveCount(0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/lex-onboarding-mobile.png', fullPage: true })
})

test('team management is a dedicated sidebar page on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockSession(page, true)
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible()
  await expect(page.getByText('Autumn intake')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate code' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Team Management' })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/lex-team-management-desktop.png', fullPage: true })
})
