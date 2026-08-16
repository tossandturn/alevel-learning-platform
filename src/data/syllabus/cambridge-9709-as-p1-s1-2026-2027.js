/*
 * Cambridge International AS & A Level Mathematics 9709, 2026-2027.
 *
 * Source taxonomy for the AS route that combines Paper 1 Pure Mathematics 1
 * with Paper 5 Probability & Statistics 1. The platform keeps Paper 5 as the
 * source component while presenting it to students as S1.
 */

export const CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9709',
  syllabusVersion: '2026-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf',
  subjectContentPages: Object.freeze([19, 20, 21, 22, 34, 35, 36]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Paper 1 Pure Mathematics 1' }),
    Object.freeze({ component: 5, stage: 'AS', track: 'theory', label: 'Paper 5 Probability & Statistics 1', studentLabel: 'S1' }),
  ]),
})

const ROUTE_ID = 'cie-9709-as-p1-p5'

function topic({ id, code, name, order, officialPage, component }) {
  return Object.freeze({
    id,
    routeId: ROUTE_ID,
    syllabusVersion: CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE.syllabusVersion,
    code,
    name,
    order,
    officialPage,
    component,
    points: Object.freeze([]),
  })
}

export const CAMBRIDGE_9709_AS_P1_S1_TOPICS = Object.freeze([
  topic({ id: '9709-p1-topic-01', code: '1.1', name: 'Quadratics', order: 1, officialPage: 19, component: 1 }),
  topic({ id: '9709-p1-topic-02', code: '1.2', name: 'Functions', order: 2, officialPage: 19, component: 1 }),
  topic({ id: '9709-p1-topic-03', code: '1.3', name: 'Coordinate geometry', order: 3, officialPage: 20, component: 1 }),
  topic({ id: '9709-p1-topic-04', code: '1.4', name: 'Circular measure', order: 4, officialPage: 20, component: 1 }),
  topic({ id: '9709-p1-topic-05', code: '1.5', name: 'Trigonometry', order: 5, officialPage: 20, component: 1 }),
  topic({ id: '9709-p1-topic-06', code: '1.6', name: 'Series', order: 6, officialPage: 21, component: 1 }),
  topic({ id: '9709-p1-topic-07', code: '1.7', name: 'Differentiation', order: 7, officialPage: 21, component: 1 }),
  topic({ id: '9709-p1-topic-08', code: '1.8', name: 'Integration', order: 8, officialPage: 22, component: 1 }),
  topic({ id: '9709-s1-topic-01', code: '5.1', name: 'Representation of data', order: 9, officialPage: 34, component: 5 }),
  topic({ id: '9709-s1-topic-02', code: '5.2', name: 'Permutations and combinations', order: 10, officialPage: 34, component: 5 }),
  topic({ id: '9709-s1-topic-03', code: '5.3', name: 'Probability', order: 11, officialPage: 34, component: 5 }),
  topic({ id: '9709-s1-topic-04', code: '5.4', name: 'Discrete random variables', order: 12, officialPage: 35, component: 5 }),
  topic({ id: '9709-s1-topic-05', code: '5.5', name: 'The normal distribution', order: 13, officialPage: 36, component: 5 }),
])

export const CAMBRIDGE_9709_AS_P1_S1_SYLLABUS = Object.freeze({
  routeId: ROUTE_ID,
  syllabusVersion: CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE.syllabusVersion,
  officialUrl: CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE.officialUrl,
  assessmentComponents: CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE.assessmentComponents,
  topics: CAMBRIDGE_9709_AS_P1_S1_TOPICS,
  points: Object.freeze(CAMBRIDGE_9709_AS_P1_S1_TOPICS.flatMap((item) => item.points)),
})
