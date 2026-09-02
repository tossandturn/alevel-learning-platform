import { useEffect, useState } from 'react'
import { routeById } from '../data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute } from '../lib/syllabusPracticeRoutes.js'

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function validateSyllabusInventoryPayload(payload, expectedRouteId = '') {
  if (!isPlainObject(payload)) throw new Error('Syllabus inventory returned an invalid response.')
  if (!Array.isArray(payload.topics)) throw new Error('Syllabus inventory returned an invalid topic list.')
  if (!Array.isArray(payload.assessmentComponents)) throw new Error('Syllabus inventory returned invalid assessment components.')

  const expectedRoute = expectedRouteId ? routeById(String(expectedRouteId)) : null
  if (expectedRouteId && !expectedRoute) throw new Error('Syllabus inventory routeId is not registered.')
  if (expectedRoute && String(payload.routeId || '').trim() !== expectedRoute.routeId) {
    throw new Error('Syllabus inventory routeId does not match the selected course.')
  }
  if (expectedRoute) {
    if (String(payload.qualification || '').trim() !== expectedRoute.qualification) throw new Error('Syllabus inventory qualification does not match the selected course.')
    if (String(payload.subject || '').trim() !== expectedRoute.subject) throw new Error('Syllabus inventory subject does not match the selected course.')
    if (String(payload.subjectId || '').trim() !== expectedRoute.subjectId) throw new Error('Syllabus inventory subjectId does not match the selected course.')
    if (String(payload.subjectCode || '').trim() !== expectedRoute.subjectCode) throw new Error('Syllabus inventory subjectCode does not match the selected course.')
    if (String(payload.stage || '').trim() !== expectedRoute.stage) throw new Error('Syllabus inventory stage does not match the selected course.')
    const paperComponents = Array.isArray(payload.paperComponents) ? payload.paperComponents.map(Number) : []
    const expectedPaperComponents = syllabusPracticeComponentsForRoute(expectedRoute.routeId)
    const scopedPaperComponents = expectedPaperComponents.length ? expectedPaperComponents : expectedRoute.paperComponents
    if (paperComponents.length !== scopedPaperComponents.length
      || paperComponents.some((component, index) => component !== Number(scopedPaperComponents[index]))) {
      throw new Error('Syllabus inventory paper components do not match the selected course.')
    }
  }

  const topics = payload.topics.map((topic, index) => {
    if (!isPlainObject(topic)) throw new Error(`Syllabus inventory topic ${index + 1} is invalid.`)
    const id = String(topic.id || '').trim()
    const code = String(topic.code || '').trim()
    const name = String(topic.name || topic.title || '').trim()
    if (!id || !code || !name) throw new Error(`Syllabus inventory topic ${index + 1} is missing id, code, or name.`)
    const routeId = String(topic.routeId || payload.routeId || '').trim()
    if (expectedRoute && routeId !== expectedRoute.routeId) {
      throw new Error(`Syllabus inventory topic ${index + 1} routeId does not match the selected course.`)
    }
    return {
      ...topic,
      id,
      code,
      name,
      routeId,
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
    if (expectedRoute) {
      if (String(component.stage || '').trim() !== expectedRoute.stage) {
        throw new Error(`Syllabus inventory assessment component ${index + 1} stage does not match the selected course.`)
      }
      if (!expectedRoute.paperComponents.includes(componentNumber)) {
        throw new Error(`Syllabus inventory assessment component ${index + 1} is outside the selected course.`)
      }
    }
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
        return validateSyllabusInventoryPayload(payload, routeId)
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
