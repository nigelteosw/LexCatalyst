import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './app/App.tsx'

// Dynamic viewport units alone do not follow the keyboard in iOS Safari.
// Keep the app's scroll regions and composers inside the unobscured viewport.
const visualViewport = window.visualViewport
function updateViewportHeight() {
  if (!visualViewport || visualViewport.scale !== 1) return
  document.documentElement.style.setProperty('--app-height', `${visualViewport.height}px`)
  document.documentElement.style.setProperty('--app-offset-top', `${visualViewport.offsetTop}px`)
}
updateViewportHeight()
visualViewport?.addEventListener('resize', updateViewportHeight)
visualViewport?.addEventListener('scroll', updateViewportHeight)
window.addEventListener('resize', updateViewportHeight)

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
