import { expect, test } from 'bun:test'
import { clampBirdieFrame, defaultBirdieFrame } from '../src/features/birdie/panelFrame'

test('panel starts above the fixed launcher', () => {
  const frame = defaultBirdieFrame(1200, 800)
  expect(frame.width).toBe(320)
  expect(frame.height).toBe(480)
  expect(frame.y + frame.height).toBeLessThanOrEqual(720)
})

test('dragging and resizing cannot strand the header outside the viewport', () => {
  const frame = clampBirdieFrame({ x: -200, y: 900, width: 700, height: 900 }, 390, 600)
  expect(frame.x).toBeGreaterThanOrEqual(8)
  expect(frame.y).toBeGreaterThanOrEqual(8)
  expect(frame.x + frame.width).toBeLessThanOrEqual(382)
  expect(frame.y + frame.height).toBeLessThanOrEqual(520)
})

test('viewport shrink keeps a resized panel and composer reachable', () => {
  const frame = clampBirdieFrame({ x: 800, y: 400, width: 500, height: 600 }, 320, 450)
  expect(frame.width).toBe(304)
  expect(frame.height).toBe(362)
  expect(frame.y + frame.height).toBeLessThanOrEqual(370)
})
