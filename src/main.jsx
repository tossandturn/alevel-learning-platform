import { Component, StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startRuntimePerformanceMonitoring } from './lib/runtimePerformance'

startRuntimePerformanceMonitoring()

const App = lazy(() => import('./App.jsx'))

function setBootFallback({ hidden = true, title = '', message = '' } = {}) {
  if (typeof document === 'undefined') return
  const fallback = document.getElementById('boot-fallback')
  if (!fallback) return
  fallback.hidden = hidden
  if (title) {
    const heading = fallback.querySelector('strong')
    if (heading) heading.textContent = title
  }
  if (message) {
    const copy = fallback.querySelector('p')
    if (copy) copy.textContent = message
  }
}

export function AppLoadingFallback() {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    setBootFallback()
    const timer = window.setTimeout(() => setTimedOut(true), 8000)
    return () => window.clearTimeout(timer)
  }, [])

  if (timedOut) {
    return (
      <main className="app-recovery" role="alert">
        <section className="app-recovery__panel">
          <p className="app-recovery__eyebrow">STEM Studio</p>
          <h1>STEM is taking too long to open</h1>
          <p>The app module did not arrive in time. Reload STEM to retry the current release.</p>
          <div className="app-recovery__actions">
            <button type="button" className="primary-action" onClick={() => window.location.reload()}>Reload STEM</button>
          </div>
        </section>
      </main>
    )
  }

  return <main className="app-loading" role="status"><span className="loading-line" />Opening STEM Studio...</main>
}

export class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (typeof window !== 'undefined') window.__stemLastAppError = String(error?.message || error || 'unknown error')
    setBootFallback()
  }

  retry = () => {
    // A rejected React.lazy promise is cached by React. Reloading is the only
    // reliable way to retry a stale or failed Vite module graph.
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="app-recovery" role="alert">
        <section className="app-recovery__panel">
          <p className="app-recovery__eyebrow">STEM Studio</p>
          <h1>STEM could not open this screen</h1>
          <p>The app did not finish loading. Your saved work is still on this device. Try again, or reload STEM to pick up the latest release.</p>
          <div className="app-recovery__actions">
            <button type="button" className="primary-action" onClick={this.retry}>Try again</button>
            <button type="button" className="secondary-action" onClick={() => window.location.reload()}>Reload STEM</button>
          </div>
        </section>
      </main>
    )
  }
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.__stemChunkLoadError = true
  let shouldReload = false
  try {
    const key = 'stem:chunk-reload-at'
    const previous = Number(window.sessionStorage.getItem(key) || 0)
    shouldReload = !previous || Date.now() - previous > 30_000
    if (shouldReload) window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    shouldReload = false
  }
  if (shouldReload) {
    setBootFallback({
      hidden: false,
      title: 'Refreshing STEM Studio...',
      message: 'The current page bundle changed. Reloading the latest version.',
    })
    window.location.reload()
    return
  }
  setBootFallback({
    hidden: false,
    title: 'STEM could not load this page',
    message: 'The latest page bundle is unavailable. Use Reload STEM to try again.',
  })
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<AppLoadingFallback />}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
)
