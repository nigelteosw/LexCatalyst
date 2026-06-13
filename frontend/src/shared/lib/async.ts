export function waitForDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
