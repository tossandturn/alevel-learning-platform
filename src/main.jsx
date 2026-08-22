import { Component, StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { freshReloadUrl, isBootFailure } from './lib/bootRecovery'
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
  const reloadLink = fallback.querySelector('a')
  if (reloadLink && typeof window !== 'undefined') {
    reloadLink.href = freshReloadUrl(window.location.href)
  }
}

function clearBootRecoveryParam() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('_stem_reload')) return
  url.searchParams.delete('_stem_reload')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

let appReady = false

function markAppReady() {
  appReady = true
  setBootFallback({ hidden: true })
  clearBootRecoveryParam()
  try {
    window.sessionStorage.removeItem('stem:chunk-reload-at')
  } catch {
    // Storage can be unavailable in privacy mode; the app remains usable.
  }
}

if (typeof window !== 'undefined') window.__stemAppReady = markAppReady

export function AppLoadingFallback() {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTimedOut(true)
      setBootFallback({
        hidden: false,
        title: 'STEM is taking too long to open',
        message: 'The app module did not arrive in time. Reload STEM to retry the current release.',
      })
    }, 8000)
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
    setBootFallback({
      hidden: false,
      title: 'STEM could not open this page',
      message: 'The page failed before it finished loading. Use Reload STEM to try the current release again.',
    })
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

let bootRecoveryStarted = false

function handleBootFailure(reason = '') {
  if (appReady || !isBootFailure(reason, { appReady })) return
  let shouldReload = false
  try {
    const key = 'stem:chunk-reload-at'
    const previous = Number(window.sessionStorage.getItem(key) || 0)
    shouldReload = !previous || Date.now() - previous > 30_000
    if (shouldReload) window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    shouldReload = !bootRecoveryStarted
  }
  if (bootRecoveryStarted) return
  bootRecoveryStarted = true
  if (shouldReload) {
    setBootFallback({
      hidden: false,
      title: 'Refreshing STEM Studio...',
      message: 'The current page bundle changed. Reloading the latest version.',
    })
    window.location.replace(freshReloadUrl())
    return
  }
  setBootFallback({
    hidden: false,
    title: 'STEM could not load this page',
    message: 'The latest page bundle is unavailable. Use Reload STEM to try again.',
  })
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.__stemChunkLoadError = true
  handleBootFailure(event)
})

window.addEventListener('unhandledrejection', (event) => {
  handleBootFailure(event.reason)
})

window.addEventListener('error', (event) => {
  if (event.target instanceof HTMLScriptElement || isBootFailure(event.error || event.message, { appReady })) {
    handleBootFailure(event.error || event.message)
  }
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  setBootFallback({
    hidden: false,
    title: 'STEM could not open this page',
    message: 'The page shell is incomplete. Reload STEM to restore the current release.',
  })
} else {
  const reactRoot = rootElement.__stemReactRoot || createRoot(rootElement)
  rootElement.__stemReactRoot = reactRoot

  reactRoot.render(
    <StrictMode>
      <AppErrorBoundary>
        <Suspense fallback={<AppLoadingFallback />}>
          <App />
        </Suspense>
      </AppErrorBoundary>
    </StrictMode>,
  )
}
