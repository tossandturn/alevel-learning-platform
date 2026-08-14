import { useEffect, useState } from 'react'

export function useSyllabusInventory(routeId, { enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: '' })

  useEffect(() => {
    if (!enabled || !routeId) {
      setState({ status: 'idle', data: null, error: '' })
      return undefined
    }
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: '' })
    fetch(`/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || `Syllabus inventory failed (${response.status}).`)
        if (!Array.isArray(payload.topics)) throw new Error('Syllabus inventory returned an invalid topic list.')
        return payload
      })
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((error) => {
        if (error.name === 'AbortError') return
        setState({ status: 'error', data: null, error: error.message || 'Syllabus inventory could not be loaded.' })
      })
    return () => controller.abort()
  }, [enabled, routeId])

  return state
}
