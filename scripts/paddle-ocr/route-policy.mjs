import { courseRoutes } from '../../src/data/routeRegistry.js'

// Practical papers stay in OCR staging, but they must never become Topic Drill
// candidates. The allow-list is the single policy shared by queue planning and
// release-time syllabus validation.
export const PADDLE_THEORY_COMPONENTS_BY_SUBJECT = Object.freeze({
  '0580': Object.freeze([1, 2, 3, 4]),
  '0606': Object.freeze([1, 2]),
  '0610': Object.freeze([1, 2, 3, 4]),
  '0625': Object.freeze([2]),
  '9231': Object.freeze([1, 2, 3, 4]),
  '9700': Object.freeze([1, 2, 4]),
  '9701': Object.freeze([1, 2, 4]),
  '9702': Object.freeze([1, 2, 4]),
  '9708': Object.freeze([1, 2, 3, 4]),
  '9709': Object.freeze([1, 2, 3, 4, 5, 6]),
})

const CIE_SUBJECT_CODES = new Set(Object.keys(PADDLE_THEORY_COMPONENTS_BY_SUBJECT))
const ROUTE_POLICIES = new Map(courseRoutes
  .filter((route) => CIE_SUBJECT_CODES.has(String(route.subjectCode)))
  .map((route) => {
    const subject = String(route.subjectCode)
    const allowed = PADDLE_THEORY_COMPONENTS_BY_SUBJECT[subject]
    const components = [...new Set(route.paperComponents
      .map((component) => Number(component))
      .filter((component) => Number.isInteger(component) && allowed.includes(component)))]
    return [route.routeId, Object.freeze({
      routeId: route.routeId,
      subject,
      stage: route.stage,
      components: Object.freeze(components),
    })]
  }))

export const PADDLE_ELIGIBLE_ROUTE_IDS = Object.freeze([...ROUTE_POLICIES.keys()]
  .filter((routeId) => ROUTE_POLICIES.get(routeId).components.length > 0))

export function routePolicyForRoute(routeId) {
  const policy = ROUTE_POLICIES.get(String(routeId || '').trim())
  return policy?.components.length ? policy : null
}

export function routePlansForJob(job) {
  const subject = String(job?.subject || '').trim()
  const component = Number(job?.component)
  const allowed = PADDLE_THEORY_COMPONENTS_BY_SUBJECT[subject]
  if (!allowed || !Number.isInteger(component) || !allowed.includes(component)) {
    throw routePolicyError('PADDLE_ROUTE_UNSUPPORTED', `unsupported route ${subject}:${component}`)
  }

  const candidates = PADDLE_ELIGIBLE_ROUTE_IDS
    .map((routeId) => ROUTE_POLICIES.get(routeId))
    .filter((policy) => policy.subject === subject && policy.components.includes(component))
  if (!candidates.length) {
    throw routePolicyError('PADDLE_ROUTE_UNSUPPORTED', `no registered route for ${subject}:${component}`)
  }

  const bindings = Array.isArray(job?.routeBindings) ? job.routeBindings : []
  const declared = bindings
    .map((binding) => String(binding?.routeCandidateId || binding?.routeHint || '').trim())
    .filter(Boolean)
  const expected = candidates.map((candidate) => candidate.routeId)
  if (bindings.length && (declared.length !== bindings.length
    || new Set(declared).size !== declared.length
    || declared.length !== expected.length
    || declared.some((routeId) => !expected.includes(routeId)))) {
    throw routePolicyError('PADDLE_ROUTE_BINDING_MISMATCH', `queue route bindings do not match ${subject}:${component}`)
  }

  return Object.freeze(candidates.map((candidate) => Object.freeze({
    ...candidate,
    component,
    components: Object.freeze([...candidate.components]),
  })))
}

function routePolicyError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}
