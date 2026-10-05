import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionList } from '../src/features/actions/components/ActionList'
import type { ActionItem } from '../src/shared/types/workspace'

const ticket: ActionItem = {
  id: 'ticket-1', title: 'Review <draft>', status: 'review', priority: 'high',
  matterId: 'matter-1', assignerId: 'user-1', tags: [],
  createdAt: '', updatedAt: '',
}

test('list shows real ticket, matter and status with safe text and unassigned fallback', () => {
  const html = renderToStaticMarkup(<ActionList items={[ticket]} matters={[{ id: 'matter-1', title: 'Vendor agreement', caseNumber: 'M-42' }]} onSelect={() => {}} />)
  expect(html).toContain('Review &lt;draft&gt;')
  expect(html).toContain('M-42 · Vendor agreement')
  expect(html).toContain('Internal review</span>')
  expect(html).toContain('Unassigned')
  expect(html).toContain('<table')
  expect(html).toContain('<button')
})

test('empty filtered list shows an explicit empty state', () => {
  const html = renderToStaticMarkup(<ActionList items={[]} matters={[]} onSelect={() => {}} />)
  expect(html).toContain('No tickets match these filters.')
})

test('client stage is rendered in the list', () => {
  const html = renderToStaticMarkup(<ActionList items={[{ ...ticket, status: 'with_client' }]} matters={[]} onSelect={() => {}} />)
  expect(html).toContain('With client / counterparty')
})
