import { useEffect, useState } from 'react'

export function usePaperCatalog() {
  const [state, setState] = useState({ status: 'loading', catalog: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/papers.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`)
        return response.json()
      })
      .then((catalog) => setState({ status: 'ready', catalog, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', catalog: null, error: error.message })
      })
    return () => controller.abort()
  }, [])

  return state
}
