/* Cambridge International AS & A Level Further Mathematics 9231, 2026-2027. */

export const CAMBRIDGE_9231_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9231',
  syllabusVersion: '2026-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/697357-2026-2027-syllabus.pdf',
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Paper 1 Further Pure Mathematics 1' }),
    Object.freeze({ component: 2, stage: 'A2', track: 'theory', label: 'Paper 2 Further Pure Mathematics 2' }),
    Object.freeze({ component: 3, stage: 'AS/A2', track: 'theory', label: 'Paper 3 Further Mechanics' }),
    Object.freeze({ component: 4, stage: 'AS/A2', track: 'theory', label: 'Paper 4 Further Probability & Statistics' }),
  ]),
})

const COMPONENT_ROWS = Object.freeze({
  1: Object.freeze([
    ['9231-p1-topic-01', '1.1', 'Roots of polynomial equations'],
    ['9231-p1-topic-02', '1.2', 'Rational functions and graphs'],
    ['9231-p1-topic-03', '1.3', 'Summation of series'],
    ['9231-p1-topic-04', '1.4', 'Matrices'],
    ['9231-p1-topic-05', '1.5', 'Polar coordinates'],
    ['9231-p1-topic-06', '1.6', 'Vectors'],
    ['9231-p1-topic-07', '1.7', 'Proof by induction'],
  ]),
  2: Object.freeze([
    ['9231-p2-topic-01', '2.1', 'Hyperbolic functions'],
    ['9231-p2-topic-02', '2.2', 'Matrices'],
    ['9231-p2-topic-03', '2.3', 'Differentiation'],
    ['9231-p2-topic-04', '2.4', 'Integration'],
    ['9231-p2-topic-05', '2.5', 'Complex numbers'],
    ['9231-p2-topic-06', '2.6', 'Differential equations'],
  ]),
  3: Object.freeze([
    ['9231-p3-topic-01', '3.1', 'Motion of a projectile'],
    ['9231-p3-topic-02', '3.2', 'Equilibrium of a rigid body'],
    ['9231-p3-topic-03', '3.3', 'Circular motion'],
    ['9231-p3-topic-04', '3.4', "Hooke's law"],
    ['9231-p3-topic-05', '3.5', 'Linear motion under a variable force'],
    ['9231-p3-topic-06', '3.6', 'Momentum'],
  ]),
  4: Object.freeze([
    ['9231-p4-topic-01', '4.1', 'Continuous random variables'],
    ['9231-p4-topic-02', '4.2', 'Inference using normal and t-distributions'],
    ['9231-p4-topic-03', '4.3', 'Chi-squared tests'],
    ['9231-p4-topic-04', '4.4', 'Non-parametric tests'],
    ['9231-p4-topic-05', '4.5', 'Probability generating functions'],
  ]),
})

function componentTopics(component) {
  const metadata = CAMBRIDGE_9231_SYLLABUS_SOURCE.assessmentComponents.find((item) => item.component === component)
  return Object.freeze(COMPONENT_ROWS[component].map(([id, code, name], index) => Object.freeze({
    id,
    code,
    name,
    order: index + 1,
    syllabusVersion: CAMBRIDGE_9231_SYLLABUS_SOURCE.syllabusVersion,
    officialUrl: CAMBRIDGE_9231_SYLLABUS_SOURCE.officialUrl,
    component,
    componentScope: Object.freeze({ component, stage: metadata.stage, track: metadata.track, label: metadata.label }),
    points: Object.freeze([]),
  })))
}

export const CAMBRIDGE_9231_TOPICS_BY_COMPONENT = Object.freeze(Object.fromEntries(
  [1, 2, 3, 4].map((component) => [component, componentTopics(component)]),
))

const ROUTE_COMPONENTS = Object.freeze({
  'cie-9231-as-p1-p3': Object.freeze([1, 3]),
  'cie-9231-as-p1-p4': Object.freeze([1, 4]),
  'cie-9231-a2-after-p1-p3-p2-p4': Object.freeze([2, 4]),
  'cie-9231-a2-after-p1-p4-p2-p3': Object.freeze([2, 3]),
})

export function cambridge9231TopicsForRoute(routeId, components = ROUTE_COMPONENTS[routeId] || []) {
  return Object.freeze(components.flatMap((component) => CAMBRIDGE_9231_TOPICS_BY_COMPONENT[component] || []))
}

export function cambridge9231SyllabusForRoute(routeId, components = ROUTE_COMPONENTS[routeId] || []) {
  const topics = cambridge9231TopicsForRoute(routeId, components)
  if (!topics.length) return null
  const stage = String(routeId).includes('-a2-') ? 'A2' : 'AS'
  return Object.freeze({
    ...CAMBRIDGE_9231_SYLLABUS_SOURCE,
    routeId,
    stage,
    assessmentComponents: Object.freeze(CAMBRIDGE_9231_SYLLABUS_SOURCE.assessmentComponents.filter((item) => components.includes(item.component))),
    componentScope: Object.freeze(CAMBRIDGE_9231_SYLLABUS_SOURCE.assessmentComponents
      .filter((item) => components.includes(item.component))
      .map((item) => Object.freeze({ ...item, notes: Object.freeze([]) }))),
    topics,
  })
}
