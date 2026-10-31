import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ui/App.tsx'
import { ErrorBoundary, ErrorScreen } from './ui/ErrorBoundary.tsx'
import { seedIfEmpty } from './db/seed.ts'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// A failed seed (e.g. IndexedDB unavailable) would otherwise leave every screen blank.
seedIfEmpty().catch(err => {
  console.error('Seeding failed', err)
  root.render(
    <StrictMode>
      <ErrorScreen error={err} />
    </StrictMode>,
  )
})
