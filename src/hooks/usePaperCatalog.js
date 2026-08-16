import { useCallback, useEffect, useRef, useState } from 'react'

export function usePaperCatalog({ enabled = true } = {}) {
  const [state, setState] = useState({ status: 'loading', catalog: null, error: null })
  const requestRef = useRef(null)
  const catalogRef = useRef(null)

  const load = useCallback(() => {
    if (catalogRef.current) return Promise.resolve(catalogRef.current)
    if (requestRef.current) return requestRef.current
    setState((current) => current.catalog ? current : { status: 'loading', catalog: null, error: null })
    const request = fetch('/data/papers.json')
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
        catalogRef.current = catalog
        setState({ status: 'ready', catalog, error: null })
        return catalog
      })
      .catch((error) => {
        setState({ status: 'error', catalog: null, error: error.message })
        throw error
      })
      .finally(() => {
        requestRef.current = null
      })
    requestRef.current = request
    return request
  }, [])

  useEffect(() => {
    if (enabled) void load().catch(() => {})
  }, [enabled, load])

  return { ...state, load }
}
