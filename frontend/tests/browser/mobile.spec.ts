import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Synthetic fixtures exercise layout without sending client data to any service.
const user = { id: 'u1', email: 'demo@example.test', full_name: 'Demo Partner', firm_role: 'partner', is_admin: true, default_team_id: null, created_at: '2026-01-01' }
const action = { id: 'a1', title: 'Review synthetic agreement with a long task title', description: 'Demo draft', status: 'review', priority: 'high', matter_id: null, assigner_id: 'u1', assignee_id: null, due_date: '2026-10-10', tags: [], active_handoff_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }
const matter = { id: 'm1', title: 'Synthetic commercial agreement with a long matter name', case_number: 'DEMO-2026-001', status: 'active', team_id: null, client_name: 'Synthetic Client', created_at: '2026-01-01', updated_at: '2026-01-01' }
const entry = { id: 'k1', title: 'Synthetic contract drafting precedent', body_markdown: '# Guidance\nReview the agreement carefully.', body_preview: 'Review the agreement carefully.', scope: 'firm', entry_type: 'knowledge_bank', tags: ['contract'], pii_status: 'clean', status: 'ready', created_by: 'u1', created_by_role: 'partner', version: 1, created_at: '2026-01-01', updated_at: '2026-01-01', matter_id: null }
const wiki = { id: 'w1', title: 'Synthetic drafting guidance', body_markdown: '# Guidance\nReview the agreement carefully.', excerpt: 'Drafting guidance', page_type: 'document', status: 'published', author_user_id: 'u1', version: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }
const handoff = { id: 'h1', action_id: 'a1', document_id: 'd1', document_filename: 'Synthetic review.pdf', can_review: true, can_annotate: true, can_remove: true, submitted_by: 'u1', submitted_at: '2026-01-01', status: 'ready_for_review', created_at: '2026-01-01', updated_at: '2026-01-01', annotations: [] }
const document = { id: 'd1', filename: 'Synthetic agreement.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'ready', matter_id: null, team_id: null, created_at: '2026-01-01', updated_at: '2026-01-01', chunk_count: 1, can_manage: true }

async function workspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-session')
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'demo@example.test', fullName: 'Demo Partner', firmRole: 'partner', isAdmin: true }))
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue()
    const path = new URL(request.url()).pathname
    if (path === '/documents/d1/file') return route.fulfill({ contentType: 'application/pdf', body: readFileSync(new URL('./fixtures/review.pdf', import.meta.url)) })
    let data: unknown = []
    if (path === '/me') data = user
    else if (path === '/chat/threads') data = [{ id: 't1', title: 'Synthetic conversation', matter_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' }]
    else if (path === '/chat/threads/t1/messages') data = [{ id: 'msg1', role: 'assistant', content: 'The agreement requires review.[1]', created_at: '2026-01-01', sources: [{ n: 1, kind: 'document', id: 'd1', title: 'Synthetic agreement', locator: 'Page 1', matter_id: null, excerpt: 'Synthetic source text.' }] }]
    else if (path === '/survey/questions') data = [{ id: 'q1', text: 'How manageable is your current workload?', category: 'workload', order_index: 1, is_active: true, reverse_scored: false, created_at: '2026-01-01' }]
    else if (path === '/matters') data = [matter]
    else if (path === '/users') data = [user]
    else if (path === '/wiki/pages') data = [wiki]
    else if (path === '/wiki/pages/w1') data = wiki
    else if (path === '/wiki/graph') data = { nodes: [], edges: [] }
    else if (path === '/memories') data = [{ id: 'mem1', category: 'preference', content: 'Synthetic drafting preference', confidence: 0.9, created_at: '2026-01-01', updated_at: '2026-01-01' }]
    else if (path === '/handoffs') data = [handoff]
    else if (path === '/handoffs/h1') data = handoff
    else if (path === '/actions') data = [action]
    else if (path === '/actions/a1') data = action
    else if (path === '/documents') data = [document]
    else if (path === '/settings/llm') data = { has_key: true, key_last4: 'test', key_source: 'user', custom_models: { high: null, mid: null }, models: { high: 'demo/high', mid: 'demo/mid' }, feature_tiers: {}, features: [{ key: 'lexchat', label: 'LexChat', default_tier: 'high' }] }
    else if (path.endsWith('/statuses') || path.endsWith('/sources')) data = []
    else if (path.includes('/entries') && !path.endsWith('/audit')) data = path.endsWith('/k1') ? entry : { items: [entry], total: 1, limit: 30, offset: 0, has_more: false, next_offset: null }
    else if (path.includes('/results')) data = { current_week_of: '2026-10-05', minimum_cohort_size: 3, current_cohort_size: 0, questions: [] }
    else if (path === '/config') data = { demo_mode: false }
    await route.fulfill({ json: data })
  })
}

test('document comment composer remains reachable on a short phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await workspace(page)
  await page.goto('/knowledge/documents/d1')
  const composer = page.getByPlaceholder('Add review context... (Cmd/Ctrl+Enter to post)')
  await expect(composer).toBeAttached()
  await page.mouse.move(150, 350)
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(300)
  const bounds = await composer.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568)
})

for (const width of [320, 390, 768, 1280]) {
  test(`workspace pages fit at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 800 })
    await workspace(page)
    for (const path of ['/home', '/chat', '/matters/general', '/matters/m1', '/knowledge', '/knowledge/k1', '/memories', '/wiki', '/wiki/w1', '/wellbeing', '/actions', '/actions/a1', '/actions/a1/review', '/settings', '/knowledge/documents/d1']) {
      await page.goto(path)
      await expect(page.locator('main').first()).toBeVisible()
      await expect(page.getByText('Loading workspace...')).toHaveCount(0)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('main')!
        return [...root.querySelectorAll('*')].filter((el) => {
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          // Wide content is allowed inside intentionally scrollable tables/PDFs.
          let parent = el.parentElement
          while (parent && parent !== root) {
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false
            parent = parent.parentElement
          }
          return style.visibility !== 'hidden' && rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
        }).map((el) => el.tagName + ': ' + el.textContent?.slice(0, 60))
      })
      expect(overflow, path).toEqual([])
      await expect(page.getByText('This page could not be opened', { exact: true })).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(path.replaceAll('/', '_') + '.png') })
      expect(errors, path).toEqual([])
    }
  })
}

test('mobile workboard list fits task, status, assignee and due date without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await workspace(page)
  await page.goto('/actions')
  await page.getByRole('button', { name: 'list', exact: true }).click()
  await expect(page.getByText(action.title)).toBeVisible()
  const table = await page.locator('table').boundingBox()
  expect(table!.width).toBeLessThanOrEqual(320)
  await expect(page.getByText('Unassigned', { exact: true })).toBeVisible()
})


test('mobile navigation and ticket dialog keep controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await workspace(page)
  await page.goto('/home')
  await page.getByRole('button', { name: 'Open menu', exact: true }).click()
  const sidebar = page.locator('aside').first()
  const rect = await sidebar.boundingBox()
  expect(rect!.width).toBeLessThanOrEqual(288)
  await sidebar.getByRole('button', { name: /Workboard/ }).click()
  await page.getByRole('button', { name: 'New ticket' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(320)
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
})

test('chat and Birdie stay usable when the viewport gets shorter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await workspace(page)
  await page.goto('/chat')
  await page.getByRole('textbox', { name: 'Ask LexChat' }).fill('Synthetic question')
  await page.setViewportSize({ width: 390, height: 450 })
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeInViewport()
  await expect(send).toBeEnabled()
  await page.getByRole('button', { name: /^Model:/ }).click()
  const menu = page.getByRole('listbox')
  await expect(menu).toBeVisible()
  const bounds = await menu.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open Birdie', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Ask Birdie' })).toBeInViewport()
  const birdie = await page.getByRole('region', { name: 'Birdie mentor' }).boundingBox()
  expect(birdie!.y + birdie!.height).toBeLessThanOrEqual(450)
})

test('phone sign-in is available before the long feature introduction', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeInViewport()
})


test('review PDF and annotations use the available phone height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await workspace(page)
  await page.goto('/actions/a1/review')
  await expect(page.locator('.rpv-core__canvas-layer canvas').first()).toBeVisible()
  const viewer = await page.locator('.rpv-core__viewer').first().boundingBox()
  expect(viewer!.height).toBeGreaterThan(120)
  expect(viewer!.y + viewer!.height).toBeLessThanOrEqual(700)
  await page.getByRole('button', { name: /^Annotations/ }).click()
  await expect(page.getByText('Select text in the PDF to add a highlight, strike, or suggestion.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Document', exact: true }).click()
  await expect(page.locator('.rpv-core__canvas-layer canvas').first()).toBeVisible()
})


test('dialog actions remain above a keyboard that only shrinks the visual viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: 390, height: 800, scale: 1, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  })
  await workspace(page)
  await page.goto('/actions')
  await page.getByRole('button', { name: 'New ticket' }).click()
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 450 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  const panel = page.getByRole('dialog').locator(':scope > div')
  await expect.poll(async () => {
    const rect = await panel.boundingBox()
    return rect!.y + rect!.height
  }).toBeLessThanOrEqual(450)
})

test('Birdie model selector accepts taps without hitting the resize handle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await workspace(page)
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Open Birdie', exact: true }).click()
  const selector = page.getByRole('region', { name: 'Birdie mentor' }).getByRole('button', { name: /^Model:/ })
  const bounds = await selector.boundingBox()
  await selector.tap({ position: { x: bounds!.width - 8, y: bounds!.height / 2 } })
  await expect(page.getByRole('listbox')).toBeVisible()
})


test('chat citations open a phone-sized source panel', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await workspace(page)
  await page.goto('/chat/t1')
  await page.getByRole('button', { name: 'Source 1', exact: true }).click()
  const source = page.getByRole('complementary', { name: 'Source 1: Synthetic agreement' })
  await expect(source).toBeVisible()
  const bounds = await source.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(320)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568)
  await source.getByRole('button', { name: 'Close source' }).click()
  await expect(source).toHaveCount(0)
})
