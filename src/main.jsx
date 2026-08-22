import { Component, StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startRuntimePerformanceMonitoring } from './lib/runtimePerformance'

startRuntimePerformanceMonitoring()

const App = lazy(() => import('./App.jsx'))

export function AppLoadingFallback() {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
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
