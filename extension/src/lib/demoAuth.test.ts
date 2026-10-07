import { afterEach, expect, it, vi } from 'vitest'
import { clearToken } from './auth'
import { switchDemoUser } from './api'

afterEach(() => vi.unstubAllGlobals())

it('uses the presenter session for repeated switches and clears it on sign-out', async () => {
  const local: Record<string, unknown> = { lexcatalystToken: 'presenter-token' }
  const session: Record<string, unknown> = {}
  const area = (data: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(data, values) },
    remove: async (key: string) => { delete data[key] },
  })
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) } })
  const headers: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    headers.push((init.headers as Record<string, string>).Authorization)
    const id = JSON.parse(init.body as string).user_id
    return new Response(JSON.stringify({ access_token: `${id}-token`, user: { id, email: `${id}@demo.test`, full_name: id } }), { status: 200 })
  })
  await switchDemoUser('jane')
  await switchDemoUser('sarah')
  expect(headers).toEqual(['Bearer presenter-token', 'Bearer presenter-token'])
  expect(local.lexcatalystToken).toBe('sarah-token')
  await clearToken()
  expect(local.lexcatalystToken).toBeUndefined()
  expect(Object.values(session).filter(Boolean)).toEqual([])
})
