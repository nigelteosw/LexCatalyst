export type BirdieFrame = { x: number; y: number; width: number; height: number }

// Reserve space for the fixed launcher, so it remains available to close Birdie.
export function clampBirdieFrame(frame: BirdieFrame, viewportWidth: number, viewportHeight: number): BirdieFrame {
  const maxWidth = Math.max(1, viewportWidth - 16)
  const maxHeight = Math.max(1, viewportHeight - 88)
  const width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), frame.width))
  const height = Math.min(maxHeight, Math.max(Math.min(280, maxHeight), frame.height))
  return {
    width,
    height,
    x: Math.max(8, Math.min(viewportWidth - width - 8, frame.x)),
    y: Math.max(8, Math.min(viewportHeight - height - 80, frame.y)),
  }
}

export function defaultBirdieFrame(viewportWidth: number, viewportHeight: number): BirdieFrame {
  const width = viewportWidth < 640 ? viewportWidth - 16 : 320
  return clampBirdieFrame({ x: viewportWidth - width - 16, y: viewportHeight - 560, width, height: 480 }, viewportWidth, viewportHeight)
}
