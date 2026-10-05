import { GOOGLE_CLIENT_ID } from './config'

const TOKEN_KEY = 'lexcatalystToken'

export async function getToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(TOKEN_KEY)
  return (stored[TOKEN_KEY] as string | undefined) ?? null
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token })
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY)
}

// Google OAuth implicit flow. The redirect URI https://<extension-id>.chromiumapp.org/
// must be registered on the same web OAuth client the frontend uses.
export async function getGoogleIdToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID was not set when this extension was built')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: 'openid email profile',
    nonce: crypto.randomUUID(),
    prompt: 'select_account',
  }).toString()

  const redirect = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })
  if (!redirect) throw new Error('Sign-in was cancelled')
  const params = new URLSearchParams(new URL(redirect).hash.slice(1))
  const idToken = params.get('id_token')
  if (!idToken) throw new Error(params.get('error') ?? 'Google did not return an ID token')
  return idToken
}
