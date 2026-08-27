import { useEffect, useState } from 'react'

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function validateSyllabusInventoryPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('Syllabus inventory returned an invalid response.')
  if (!Array.isArray(payload.topics)) throw new Error('Syllabus inventory returned an invalid topic list.')
  if (!Array.isArray(payload.assessmentComponents)) throw new Error('Syllabus inventory returned invalid assessment components.')

  const topics = payload.topics.map((topic, index) => {
    if (!isPlainObject(topic)) throw new Error(`Syllabus inventory topic ${index + 1} is invalid.`)
    const id = String(topic.id || '').trim()
    const code = String(topic.code || '').trim()
    const name = String(topic.name || topic.title || '').trim()
    if (!id || !code || !name) throw new Error(`Syllabus inventory topic ${index + 1} is missing id, code, or name.`)
    return {
      ...topic,
      id,
      code,
      name,
      routeId: String(topic.routeId || payload.routeId || '').trim(),
      points: Array.isArray(topic.points) ? topic.points : [],
      officialNotes: Array.isArray(topic.officialNotes) ? topic.officialNotes : [],
      componentScope: isPlainObject(topic.componentScope)
        ? { ...topic.componentScope, notes: Array.isArray(topic.componentScope.notes) ? topic.componentScope.notes : [] }
        : null,
      verifiedQuestionCount: finiteNumberOrNull(topic.verifiedQuestionCount) ?? 0,
      studyQuestionCount: finiteNumberOrNull(topic.studyQuestionCount) ?? 0,
      availableQuestionCount: finiteNumberOrNull(topic.availableQuestionCount ?? topic.verifiedQuestionCount) ?? 0,
      indexedQuestionCount: finiteNumberOrNull(topic.indexedQuestionCount) ?? 0,
      pendingReviewCount: finiteNumberOrNull(topic.pendingReviewCount) ?? 0,
      availableSetSizes: Array.isArray(topic.availableSetSizes) ? topic.availableSetSizes.map(Number).filter(Number.isFinite) : [],
      componentCounts: isPlainObject(topic.componentCounts) ? topic.componentCounts : {},
      questionIdsByComponent: isPlainObject(topic.questionIdsByComponent) ? topic.questionIdsByComponent : {},
    }
  })

  const assessmentComponents = payload.assessmentComponents.map((component, index) => {
    if (!isPlainObject(component)) throw new Error(`Syllabus inventory assessment component ${index + 1} is invalid.`)
    const componentNumber = finiteNumberOrNull(component.component)
    const label = String(component.label || '').trim()
    if (componentNumber == null || !label) throw new Error(`Syllabus inventory assessment component ${index + 1} is missing component or label.`)
    return {
      ...component,
      component: componentNumber,
      label,
      stage: String(component.stage || '').trim(),
      track: String(component.track || '').trim(),
    }
  })

  return {
    ...payload,
    topics,
    assessmentComponents,
  }
}

export function useSyllabusInventory(routeId, { enabled = true } = {}) {
  const [state, setState] = useState({ routeId, status: enabled ? 'loading' : 'idle', data: null, error: '' })

  useEffect(() => {
    if (!enabled || !routeId) {
      setState({ routeId, status: 'idle', data: null, error: '' })
      return undefined
    }
    const controller = new AbortController()
    setState({ routeId, status: 'loading', data: null, error: '' })
    fetch(`/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || `Syllabus inventory failed (${response.status}).`)
        return validateSyllabusInventoryPayload(payload)
      })
      .then((data) => setState({ routeId, status: 'ready', data, error: '' }))
      .catch((error) => {
        if (error.name === 'AbortError') return
        setState({ routeId, status: 'error', data: null, error: error.message || 'Syllabus inventory could not be loaded.' })
      })
    return () => controller.abort()
  }, [enabled, routeId])

  return state.routeId === routeId
    ? state
    : { routeId, status: enabled ? 'loading' : 'idle', data: null, error: '' }
}
