import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Serve the real extension build with synthetic Chrome APIs and backend responses.
// Run `cd extension && bun run build` before this test.
test('extension switches repeatedly, reloads user settings and clears previous reviews', async ({ page }) => {
  const settingsUsers: string[] = []
  const switchTokens: string[] = []
  await page.addInitScript(() => {
    const local: Record<string, unknown> = { lexcatalystToken: 'presenter' }
    const session: Record<string, unknown> = {}
    const event = { addListener: () => {}, removeListener: () => {} }
    const area = (data: Record<string, unknown>) => ({
      get: async (key: string) => ({ [key]: data[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(data, values) },
      remove: async (key: string) => { delete data[key] },
    })
    Object.assign(window, { chrome: {
      storage: { local: area(local), session: area(session), onChanged: event },
      tabs: { query: async () => [{ id: 1, url: 'https://example.test/draft', title: 'Demo letter' }], onActivated: event, onUpdated: event },
      windows: { onFocusChanged: event }, runtime: { onMessage: event, getURL: (name: string) => `/extension-demo/${name}` },
      permissions: { contains: async () => true },
      scripting: { executeScript: async () => [{ result: 'A will B' }] },
    } })
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/extension-demo/')) {
      const name = url.pathname.slice('/extension-demo/'.length)
      if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="./sidepanel.js"></script>' })
      return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/javascript', body: readFileSync(new URL(`../../../extension/dist/${name}`, import.meta.url)) })
    }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, DELETE, PATCH, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const actor = (route.request().headers().authorization ?? '').replace('Bearer ', '')
    let data: unknown = []
    const demoUser = (id: string) => ({ id, email: `${id}@demo.test`, full_name: id })
    if (url.pathname === '/me') data = demoUser(actor)
    else if (url.pathname === '/demo/users') data = [demoUser('jane'), demoUser('sarah')]
    else if (url.pathname === '/demo/switch') {
      switchTokens.push(actor)
      if (actor !== 'presenter') return route.fulfill({ status: 404, json: { detail: 'Not found' } })
      const id = route.request().postDataJSON().user_id
      data = { access_token: id, user: demoUser(id) }
    } else if (url.pathname === '/settings/llm') {
      settingsUsers.push(actor)
      data = { has_key: true, key_source: 'demo', models: { high: `${actor}/high`, mid: `${actor}/mid` }, feature_tiers: { birdie: 'mid' } }
    } else if (url.pathname === '/birdie/reviews') {
      data = actor === 'presenter' ? {
        id: 'r1', source_url: 'https://example.test/draft', title: 'Presenter draft', status: 'ready',
        source_text: 'Presenter private draft', current_text: 'Presenter private draft', suggestions: [], created_at: '2026-10-07',
      } : null
    } else return route.continue()
    return route.fulfill({ json: data, headers })
  })
  await page.goto('/extension-demo/index.html')
  await expect(page.getByLabel('View as demo user')).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Presenter private draft', { exact: true })).toBeVisible()
  await page.getByLabel('View as demo user').selectOption('jane')
  await expect.poll(() => settingsUsers.includes('jane')).toBe(true)
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Presenter private draft', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review this draft', exact: true })).toBeEnabled()
  await page.getByLabel('View as demo user').selectOption('sarah')
  await expect.poll(() => settingsUsers.includes('sarah')).toBe(true)
  expect(switchTokens).toEqual(['presenter', 'presenter'])
})
