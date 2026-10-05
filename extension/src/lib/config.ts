export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://lexcatalyst-production.up.railway.app'

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export const APP_URL: string = (import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://lexcatalyst.pages.dev'
