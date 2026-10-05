import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BirdieSidePanel } from './BirdieSidePanel'
import './sidepanel.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BirdieSidePanel />
  </StrictMode>,
)
