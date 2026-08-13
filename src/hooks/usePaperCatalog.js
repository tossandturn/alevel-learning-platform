import { useEffect, useState } from 'react'

export function usePaperCatalog() {
  const [state, setState] = useState({ status: 'loading', catalog: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/papers.json', { signal: controller.signal })
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
        setState({ status: 'ready', catalog, error: null })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', catalog: null, error: error.message })
      })
    return () => controller.abort()
  }, [])

  return state
}
