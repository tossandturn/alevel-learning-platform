const SYLLABUS_PRACTICE_ROUTE_IDS = Object.freeze([
  'cie-0580-igcse-mathematics',
  'cie-0606-igcse-additional-mathematics',
  'cie-0625-igcse-physics',
  'cie-9702-as-physics',
  'cie-9702-a2-physics',
  'cie-9709-as-p1-p2',
  'cie-9709-as-p1-p4',
  'cie-9709-as-p1-p5',
  'cie-9709-a2-after-p1-p5-p3-p4',
  'cie-9709-a2-after-p1-p5-p3-p6',
  'cie-9709-a2-after-p1-p4-p3-p5',
])

const COMPONENTS_BY_ROUTE = Object.freeze({
  'cie-0580-igcse-mathematics': Object.freeze([1, 2, 3, 4]),
  'cie-0606-igcse-additional-mathematics': Object.freeze([1, 2]),
  'cie-0625-igcse-physics': Object.freeze([2]),
  'cie-9702-as-physics': Object.freeze([1, 2]),
  'cie-9702-a2-physics': Object.freeze([4, 5]),
  'cie-9709-as-p1-p2': Object.freeze([1, 2]),
  'cie-9709-as-p1-p4': Object.freeze([1, 4]),
  'cie-9709-as-p1-p5': Object.freeze([1, 5]),
  'cie-9709-a2-after-p1-p5-p3-p4': Object.freeze([3, 4]),
  'cie-9709-a2-after-p1-p5-p3-p6': Object.freeze([3, 6]),
  'cie-9709-a2-after-p1-p4-p3-p5': Object.freeze([3, 5]),
})

const LEGACY_TOPIC_BY_ROUTE = Object.freeze({
  'cie-0580-igcse-mathematics': Object.freeze({
    'math-0580-number': '0580-igcse-topic-01',
    'math-0580-algebra': '0580-igcse-topic-02',
    'math-0580-coordinate': '0580-igcse-topic-03',
    'math-0580-geometry': '0580-igcse-topic-04',
    'math-0580-mensuration': '0580-igcse-topic-05',
    'math-0580-trigonometry': '0580-igcse-topic-06',
    'math-0580-transformations': '0580-igcse-topic-07',
    'math-0580-probability': '0580-igcse-topic-08',
    'math-0580-statistics': '0580-igcse-topic-09',
  }),
  'cie-0625-igcse-physics': Object.freeze({
    'physics-0625-forces': '0625-igcse-topic-01',
    'physics-0625-thermal': '0625-igcse-topic-02',
    'physics-0625-waves': '0625-igcse-topic-03',
    'physics-0625-electricity': '0625-igcse-topic-04',
    'physics-0625-atomic-space': '0625-igcse-topic-05',
    'physics-0625-space': '0625-igcse-topic-06',
  }),
  'cie-9702-a2-physics': Object.freeze({
    'physics-9702-topic-12': '9702-a2-topic-01',
    'physics-9702-topic-13': '9702-a2-topic-02',
    'physics-9702-topic-14': '9702-a2-topic-03',
    'physics-9702-topic-15': '9702-a2-topic-04',
    'physics-9702-topic-16': '9702-a2-topic-05',
    'physics-9702-topic-17': '9702-a2-topic-06',
    'physics-9702-topic-18': '9702-a2-topic-07',
    'physics-9702-topic-19': '9702-a2-topic-08',
    'physics-9702-topic-20': '9702-a2-topic-09',
    'physics-9702-topic-21': '9702-a2-topic-10',
    'physics-9702-topic-22': '9702-a2-topic-11',
    'physics-9702-topic-23': '9702-a2-topic-12',
    'physics-9702-topic-24': '9702-a2-topic-13',
    'physics-9702-topic-25': '9702-a2-topic-14',
    'physics-9702-practical-data': '9702-a2-topic-15',
  }),
  'cie-9702-as-physics': Object.freeze({
    'physics-9702-mechanics': 'physics-9702-topic-03',
    'physics-9702-waves': 'physics-9702-topic-07',
    'physics-9702-electricity': 'physics-9702-topic-09',
    'physics-9702-particles': 'physics-9702-topic-11',
    'physics-9702-practical-data': 'physics-9702-topic-01',
  }),
  'cie-9709-as-p1-p2': Object.freeze({
    'math-9709-pure': '9709-as-topic-01',
    'math-9709-mechanics': '9709-as-topic-03',
    'math-9709-statistics': '9709-as-topic-04',
    'math-9709-problem-solving': '9709-as-topic-01',
  }),
  'cie-9709-as-p1-p4': Object.freeze({
    'math-9709-pure': '9709-as-topic-01',
    'math-9709-mechanics': '9709-as-topic-03',
    'math-9709-statistics': '9709-as-topic-04',
    'math-9709-problem-solving': '9709-as-topic-01',
  }),
  'cie-9709-as-p1-p5': Object.freeze({
    'math-9709-pure': '9709-p1-topic-01',
    'math-9709-mechanics': '9709-p1-topic-01',
    'math-9709-statistics': '9709-s1-topic-01',
    'math-9709-problem-solving': '9709-p1-topic-01',
  }),
  'cie-9709-a2-after-p1-p5-p3-p4': Object.freeze({
    'math-9709-pure': '9709-a2-topic-01',
    'math-9709-mechanics': '9709-a2-topic-02',
    'math-9709-statistics': '9709-a2-topic-03',
    'math-9709-problem-solving': '9709-a2-topic-01',
  }),
  'cie-9709-a2-after-p1-p5-p3-p6': Object.freeze({
    'math-9709-pure': '9709-a2-topic-01',
    'math-9709-mechanics': '9709-a2-topic-02',
    'math-9709-statistics': '9709-a2-topic-04',
    'math-9709-problem-solving': '9709-a2-topic-01',
  }),
  'cie-9709-a2-after-p1-p4-p3-p5': Object.freeze({
    'math-9709-pure': '9709-a2-topic-01',
    'math-9709-mechanics': '9709-a2-topic-02',
    'math-9709-statistics': '9709-a2-topic-03',
    'math-9709-problem-solving': '9709-a2-topic-01',
  }),
})

const syllabusPracticeRouteIds = new Set(SYLLABUS_PRACTICE_ROUTE_IDS)

export function supportsSyllabusPracticeRoute(routeId) {
  return syllabusPracticeRouteIds.has(String(routeId || ''))
}

export function syllabusPracticeComponentsForRoute(routeId) {
  return [...(COMPONENTS_BY_ROUTE[String(routeId || '')] || [])]
}

export function canonicalSyllabusTopicIdForRoute(routeId, topicId) {
  const route = String(routeId || '')
  const rawTopicId = String(topicId || '').split('@')[0]
  return LEGACY_TOPIC_BY_ROUTE[route]?.[rawTopicId] || rawTopicId
}

export { SYLLABUS_PRACTICE_ROUTE_IDS }
