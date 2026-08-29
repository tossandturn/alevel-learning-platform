import { useCallback, useEffect, useRef, useState } from 'react'

const PAPER_CATALOG_TIMEOUT_MS = 10_000

export function usePaperCatalog({ enabled = true, subject = 'all' } = {}) {
  const normalizedSubject = String(subject || 'all').trim() || 'all'
  const [state, setState] = useState({ subject: normalizedSubject, status: enabled ? 'loading' : 'idle', catalog: null, error: null })
  const requestRef = useRef(null)
  const catalogRef = useRef(new Map())
  const catalogUrl = normalizedSubject === 'all'
    ? '/data/papers.json'
    : `/data/papers/${encodeURIComponent(normalizedSubject)}.json`

  const load = useCallback((options = {}) => {
    const force = Boolean(options.force)
    const cached = catalogRef.current.get(catalogUrl)
    if (!force && cached) {
      setState({ subject: normalizedSubject, status: 'ready', catalog: cached, error: null })
      return Promise.resolve(cached)
    }
    if (!force && requestRef.current?.url === catalogUrl) return requestRef.current.promise
    if (requestRef.current && requestRef.current.url !== catalogUrl) requestRef.current.controller.abort()
    setState((current) => current.subject === normalizedSubject && current.catalog && !force ? current : { subject: normalizedSubject, status: 'loading', catalog: null, error: null })
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PAPER_CATALOG_TIMEOUT_MS)
    const request = fetch(catalogUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`)
        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          throw new Error('Catalog endpoint returned HTML instead of JSON. The paper catalog is not deployed on this release.')
        }
        return response.json()
      })
      .then((catalog) => {
        if (catalog.schemaVersion !== 2 || !catalog.paperGovernance?.schemaVersion || !Array.isArray(catalog.items) || !catalog.totals?.files) {
          throw new Error('Catalog response is missing the verified paper inventory.')
        }
        catalogRef.current.set(catalogUrl, catalog)
        if (requestRef.current?.promise === request) {
          setState({ subject: normalizedSubject, status: 'ready', catalog, error: null })
        }
        return catalog
      })
      .catch((error) => {
        if (controller.signal.aborted && !timedOut) return null
        if (requestRef.current?.promise === request) {
          setState({
            subject: normalizedSubject,
            status: 'error',
            catalog: null,
            error: timedOut
              ? 'Loading the verified paper catalog took too long. Retry.'
              : error.message || 'Paper catalog could not be loaded.',
          })
        }
        throw error
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (requestRef.current?.promise === request) requestRef.current = null
      })
    requestRef.current = { url: catalogUrl, controller, promise: request }
    return request
  }, [catalogUrl, normalizedSubject])

  useEffect(() => {
    if (enabled) void load().catch(() => {})
  }, [enabled, load])

  return { ...state, load }
}
