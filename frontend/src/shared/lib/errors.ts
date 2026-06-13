export function getErrorMessage(error: unknown, fallback = 'Something went wrong.') {
  return error instanceof Error ? error.message : fallback
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}
