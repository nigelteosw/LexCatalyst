import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './sidepanel.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p className="p-4 text-sm">Birdie is loading…</p>
  </StrictMode>,
)
